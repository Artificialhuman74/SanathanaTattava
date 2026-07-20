const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { verifyIdToken: verifyFirebaseToken } = require('../services/firebaseAdmin');
const accountDeletion = require('../services/accountDeletionService');

const router = express.Router();

const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

/* Sentinel stored in users.password (which is NOT NULL) for accounts that
 * sign in with Google only. Password login refuses these with a helpful
 * message; "forgot password" can still set a real password later, turning
 * the account into a Google-or-password hybrid. */
const GOOGLE_ONLY_PASSWORD = 'GOOGLE_SIGNIN_NO_PASSWORD';

/* ── Referral Code Generation ─────────────────────────────────────────
 *  Tier 1: A0000 … Z0000 (single letter), then AA0000 … ZZ0000 (two-letter
 *          fallback once all 26 single letters are used). 26 + 676 = 702 slots.
 *  Tier 2: parent's prefix + next number under that parent
 *          (e.g. parent A0000 → A0001, A0002 …; parent AA0000 → AA0001, AA0002 …)
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Split a referral code into its letter prefix and numeric suffix.
 *  Supports both legacy single-letter (A0000) and two-letter (AA0000) forms. */
function splitReferralCode(code) {
  if (!code) return null;
  const m = /^([A-Z]+)(\d+)$/.exec(code);
  return m ? { prefix: m[1], num: m[2] } : null;
}

function generateTier1Code() {
  const usedPrefixes = new Set(
    db.prepare(`SELECT referral_code FROM users WHERE role='trader' AND tier=1`)
      .all()
      .map(r => splitReferralCode(r.referral_code)?.prefix)
      .filter(Boolean)
  );
  // First try single letters A..Z (preserves the current scheme for new dealers).
  for (const a of ALPHABET) {
    if (!usedPrefixes.has(a)) return `${a}0000`;
  }
  // Then fall back to two-letter combos AA..ZZ (alphabetical order).
  for (const a of ALPHABET) {
    for (const b of ALPHABET) {
      const pfx = `${a}${b}`;
      if (!usedPrefixes.has(pfx)) return `${pfx}0000`;
    }
  }
  return null; // 702 Tier-1 slots exhausted — caller must surface as an error.
}

function generateTier2Code(parentId) {
  const parent = db.prepare(`SELECT referral_code FROM users WHERE id=?`).get(parentId);
  const parsed = splitReferralCode(parent?.referral_code);
  if (!parsed) return null;
  const prefix = parsed.prefix;
  // LIKE 'A%' would also match two-letter children ('AA0001', 'AB0001' …) of
  // *different* parents, so filter by exact prefix match after parsing.
  const existingNums = db.prepare(
    `SELECT referral_code FROM users WHERE role='trader' AND tier=2 AND referral_code LIKE ?`,
  )
    .all(`${prefix}%`)
    .map(r => {
      const p = splitReferralCode(r.referral_code);
      return p && p.prefix === prefix ? parseInt(p.num, 10) : NaN;
    })
    .filter(n => !isNaN(n) && n > 0);
  const next = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/* ── Partner tier + referral-code resolution ──────────────────────────────
 * Shared by the password register and the Google register so both apply
 * identical rules. Returns { tier, referredById, code } on success, or
 * { error, status } to surface to the client. */
function computePartnerTierAndCode(referralCode) {
  const ref = (referralCode || '').trim();
  if (ref) {
    const referrer = db.prepare(
      `SELECT * FROM users WHERE referral_code = ? AND role='trader' AND tier=1 AND status='active'`
    ).get(ref);
    if (!referrer) return { error: 'Invalid referral code. Only Tier 1 (e.g. A0000) codes are accepted.', status: 400 };
    let code = generateTier2Code(referrer.id);
    if (!code) return { error: 'Could not generate sub-dealer code', status: 500 };
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) {
      const parsed = splitReferralCode(code);
      if (!parsed) return { error: 'Sub-dealer code generation failed', status: 500 };
      const nextNum = parseInt(parsed.num, 10) + 1;
      code = `${parsed.prefix}${String(nextNum).padStart(4, '0')}`;
    }
    return { tier: 2, referredById: referrer.id, code };
  }
  let code = generateTier1Code();
  if (!code) return { error: 'Tier-1 partner slots are full. Please contact admin.', status: 503 };
  while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) {
    code = generateTier1Code();
    if (!code) return { error: 'Tier-1 partner slots are full. Please contact admin.', status: 503 };
  }
  return { tier: 1, referredById: null, code };
}

/* ── Trader / Admin Login ─────────────────────────────────────────────── */
router.post('/login', [
  body('email').trim().isEmail().withMessage('Enter a valid email address').normalizeEmail(),
  body('password').notEmpty().withMessage('Enter your password'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is suspended' });
  if (user.password === GOOGLE_ONLY_PASSWORD) {
    return res.status(401).json({ error: 'This account uses Google sign-in. Tap "Continue with Google" instead.' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  delete user.password;
  res.json({ token: signToken(user.id, user.role), user });
});

/* ── Trader Register ──────────────────────────────────────────────────── */
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Enter a valid email address').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().trim(),
  body('address').optional().trim(),
  body('pincode').optional().trim(),
  body('referralCode').optional().trim(),
  body('willDeliver').optional(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { name, email, password, phone, address, pincode, referralCode, willDeliver, latitude, longitude } = req.body;
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'This email is already registered. Try signing in instead.' });

  const resolved = computePartnerTierAndCode(referralCode);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const { tier, referredById, code } = resolved;

  const hashed  = await bcrypt.hash(password, 12);
  const deliver = willDeliver ? 1 : 0;

  // Compute H3 index if coordinates are provided
  let h3Index = null;
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    const { latLngToH3Index } = require('../services/h3Service');
    h3Index = latLngToH3Index(lat, lng);
  }

  const result  = db.prepare(`
    INSERT INTO users (name,email,password,role,tier,referral_code,referred_by_id,phone,address,pincode,will_deliver,delivery_enabled,commission_rate,latitude,longitude,h3_index,availability_status,status)
    VALUES (?,?,?,'trader',?,?,?,?,?,?,?,?,10.0,?,?,?,'available','active')
  `).run(name, email, hashed, tier, code, referredById, phone||null, address||null, pincode||null, deliver, deliver,
         !isNaN(lat) ? lat : null, !isNaN(lng) ? lng : null, h3Index);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  delete user.password;
  res.status(201).json({ token: signToken(user.id, user.role), user });
});

/* ══════════════════════════════════════════════════════════════
   PARTNER GOOGLE SIGN-IN
   POST /partner/google
     Verify a Firebase Google token, then:
       - existing partner/admin (matched by google_uid or email) → sign in
       - no account yet → { exists:false, email, name } so the client can
         route to signup with the details prefilled (we do NOT auto-create;
         partner signup needs a delivery commitment + tier choice).
   ══════════════════════════════════════════════════════════════ */
router.post('/partner/google', [
  body('id_token').notEmpty().withMessage('id_token is required'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  let decoded;
  try {
    decoded = await verifyFirebaseToken(req.body.id_token);
  } catch (err) {
    console.error('[partner/google] token verify failed:', err.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const googleUid = decoded.uid;
  const email     = decoded.email ? String(decoded.email).toLowerCase().trim() : null;
  const name      = decoded.name || (email ? email.split('@')[0] : 'Partner');
  if (!email) return res.status(400).json({ error: 'Google account has no email' });

  // Match by google_uid first (returning), then by email (auto-link).
  let user = db.prepare(`SELECT * FROM users WHERE google_uid = ? AND role IN ('trader','admin')`).get(googleUid);
  if (!user) {
    user = db.prepare(`SELECT * FROM users WHERE email = ? AND role IN ('trader','admin')`).get(email);
    if (user && !user.google_uid) {
      db.prepare(`UPDATE users SET google_uid = ? WHERE id = ?`).run(googleUid, user.id);
      user.google_uid = googleUid;
    }
  }

  if (!user) {
    // No partner account yet — let the client route to signup, prefilled.
    return res.json({ exists: false, email, name });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is suspended' });

  delete user.password;
  res.json({ exists: true, token: signToken(user.id, user.role), user });
});

/* POST /partner/google/register
     Create a partner account from a verified Google identity (no password).
     Applies the same tier / referral rules as password signup. Called from
     the signup page after the person ticks the delivery commitment. */
router.post('/partner/google/register', [
  body('id_token').notEmpty().withMessage('id_token is required'),
  body('name').optional().trim(),
  body('phone').optional().trim(),
  body('address').optional().trim(),
  body('pincode').optional().trim(),
  body('referralCode').optional().trim(),
  body('willDeliver').optional(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  let decoded;
  try {
    decoded = await verifyFirebaseToken(req.body.id_token);
  } catch (err) {
    console.error('[partner/google/register] token verify failed:', err.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const googleUid = decoded.uid;
  const email     = decoded.email ? String(decoded.email).toLowerCase().trim() : null;
  const name      = (req.body.name && req.body.name.trim()) || decoded.name || (email ? email.split('@')[0] : 'Partner');
  if (!email) return res.status(400).json({ error: 'Google account has no email' });

  // Already a partner? Sign them in instead of erroring (idempotent).
  let existing = db.prepare(`SELECT * FROM users WHERE (google_uid = ? OR email = ?) AND role IN ('trader','admin')`).get(googleUid, email);
  if (existing) {
    if (existing.status !== 'active') return res.status(403).json({ error: 'Account is suspended' });
    if (!existing.google_uid) db.prepare(`UPDATE users SET google_uid = ? WHERE id = ?`).run(googleUid, existing.id);
    delete existing.password;
    return res.json({ token: signToken(existing.id, existing.role), user: existing });
  }

  const { phone, address, pincode, referralCode, willDeliver } = req.body;
  const resolved = computePartnerTierAndCode(referralCode);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const { tier, referredById, code } = resolved;

  const deliver = willDeliver ? 1 : 0;
  const result = db.prepare(`
    INSERT INTO users (name,email,password,google_uid,role,tier,referral_code,referred_by_id,phone,address,pincode,will_deliver,delivery_enabled,commission_rate,availability_status,status)
    VALUES (?,?,?,?,'trader',?,?,?,?,?,?,?,?,10.0,'available','active')
  `).run(name, email, GOOGLE_ONLY_PASSWORD, googleUid, tier, code, referredById,
         phone || null, address || null, pincode || null, deliver, deliver);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  delete user.password;
  res.status(201).json({ token: signToken(user.id, user.role), user });
});

/* ── Validate Tier 1 referral code (trader registration) ─────────────── */
router.get('/validate-referral/:code', (req, res) => {
  const user = db.prepare(`SELECT id, name FROM users WHERE referral_code = ? AND role='trader' AND tier=1 AND status='active'`).get(req.params.code);
  if (!user) return res.json({ valid: false });
  res.json({ valid: true, referrerName: user.name });
});

/* ── Current user ─────────────────────────────────────────────────────── */
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

/* ══════════════════════════════════════════════════════════════
   CONSUMER AUTH — Email + Password with email verification
   Flow:
     Register: POST /consumer/register  → creates account, sends verification email
               GET  /consumer/verify-email?token=xxx → marks email as verified
               POST /consumer/resend-verification → resend verification email
     Login:    POST /consumer/login → { email, password } → { token, consumer }
══════════════════════════════════════════════════════════════ */

function signConsumerToken(id) {
  return jwt.sign({ id, role: 'consumer' }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function safeConsumer(c) {
  const obj = { ...c };
  delete obj.password;
  return obj;
}

/** Generate a 6-digit OTP and store its SHA-256 hash in email_verifications */
function createVerificationOtp(email) {
  const otp  = String(Math.floor(100000 + Math.random() * 900000));
  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE email_verifications SET used = 1 WHERE email = ?').run(email);
  db.prepare('INSERT INTO email_verifications (email, token_hash, expires_at) VALUES (?, ?, ?)').run(email, hash, expires);
  return otp;
}

/* ── POST /consumer/register ──────────────────────────────── */
router.post('/consumer/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('referral_code').optional({ nullable: true }).trim(),
  body('phone').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { name, email, password, referral_code, phone } = req.body;

  if (db.prepare('SELECT id FROM consumers WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Email already registered. Please log in.' });

  if (phone && phone.trim() && db.prepare('SELECT id FROM consumers WHERE phone = ?').get(phone.trim()))
    return res.status(409).json({ error: 'Phone number already registered. Please use a different number.' });

  // Rate limit: max 5 registrations per email per hour
  const recentCount = db.prepare(`
    SELECT COUNT(*) as c FROM email_verifications
    WHERE email = ? AND created_at > datetime('now', '-1 hour')
  `).get(email).c;
  if (recentCount >= 5) return res.status(429).json({ error: 'Too many attempts. Please wait an hour.' });

  let linkedDealerId = null, usedCode = null;
  if (referral_code && referral_code.trim()) {
    const dealer = db.prepare(`SELECT * FROM users WHERE referral_code = ? AND role='trader' AND status='active'`).get(referral_code.trim().toUpperCase());
    if (!dealer) return res.status(400).json({ error: 'Invalid referral code.' });
    linkedDealerId = dealer.id;
    usedCode = referral_code.trim().toUpperCase();
  }

  const hash = await bcrypt.hash(password, 10);
  db.prepare(`
    INSERT INTO consumers (name, email, password, phone, referral_code_used, linked_dealer_id, email_verified, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
  `).run(name, email, hash, phone || null, usedCode, linkedDealerId);

  const otp = createVerificationOtp(email);

  const response = { success: true, message: 'Account created. Please verify your email.' };
  if (!process.env.EMAIL_USER) response.dev_otp = otp;
  res.status(201).json(response);

  sendVerificationEmail(email, otp).catch(err =>
    console.error('[register] email send failed:', err.message)
  );
});

/* ── POST /consumer/verify-otp ────────────────────────────── */
router.post('/consumer/verify-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('otp').notEmpty().withMessage('OTP is required'),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { email, otp } = req.body;
  const hash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
  const record = db.prepare(`
    SELECT * FROM email_verifications
    WHERE email = ? AND token_hash = ? AND used = 0 AND expires_at > datetime('now')
  `).get(email, hash);

  if (!record) return res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });

  db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(record.id);
  db.prepare('UPDATE consumers SET email_verified = 1 WHERE email = ?').run(email);

  const consumer = db.prepare('SELECT * FROM consumers WHERE email = ?').get(email);
  if (!consumer) return res.status(404).json({ error: 'Account not found.' });

  res.json({ success: true, token: signConsumerToken(consumer.id), consumer: safeConsumer(consumer) });
});

/* ── POST /consumer/resend-verification ───────────────────── */
router.post('/consumer/resend-verification', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { email } = req.body;
  const consumer = db.prepare('SELECT * FROM consumers WHERE email = ?').get(email);
  if (!consumer) return res.status(404).json({ error: 'No account found with this email.' });
  if (consumer.email_verified) return res.status(400).json({ error: 'Email is already verified.' });

  // Rate limit
  const recentCount = db.prepare(`
    SELECT COUNT(*) as c FROM email_verifications
    WHERE email = ? AND created_at > datetime('now', '-10 minutes')
  `).get(email).c;
  if (recentCount >= 3) return res.status(429).json({ error: 'Too many resend attempts. Please wait 10 minutes.' });

  const otp = createVerificationOtp(email);

  const response = { success: true };
  if (!process.env.EMAIL_USER) response.dev_otp = otp;
  res.json(response);

  sendVerificationEmail(email, otp).catch(err =>
    console.error('[resend] email send failed:', err.message)
  );
});

/* ── POST /consumer/login ─────────────────────────────────── */
router.post('/consumer/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { email, password } = req.body;
  const consumer = db.prepare('SELECT * FROM consumers WHERE email = ?').get(email);
  if (!consumer) return res.status(401).json({ error: 'No account found with this email.', code: 'EMAIL_NOT_FOUND' });
  if (consumer.status !== 'active') return res.status(403).json({ error: 'Account suspended.' });
  if (!consumer.email_verified) return res.status(403).json({ error: 'Please verify your email before logging in.', code: 'EMAIL_NOT_VERIFIED' });

  const valid = await bcrypt.compare(password, consumer.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({ token: signConsumerToken(consumer.id), consumer: safeConsumer(consumer) });
});

/* ── GET /consumer/validate-dealer/:code ──────────────────── */
router.get('/consumer/validate-dealer/:code', (req, res) => {
  const dealer = db.prepare(`SELECT id, name, tier FROM users WHERE referral_code = ? AND role='trader' AND status='active'`).get(req.params.code.toUpperCase());
  if (!dealer) return res.json({ valid: false });
  res.json({ valid: true, dealerName: dealer.name, tier: dealer.tier });
});

/* ── POST /forgot-password ─────────────────────────────────────────────── */
/* Works for traders/admin (users table) and consumers (consumers table)    */
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { email } = req.body;
  const user     = db.prepare('SELECT id FROM users     WHERE email = ?').get(email);
  const consumer = db.prepare('SELECT id FROM consumers WHERE email = ?').get(email);
  // Don't reveal whether email exists
  if (!user && !consumer) return res.json({ success: true });

  const raw    = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare('UPDATE password_resets SET used = 1 WHERE email = ?').run(email);
  db.prepare('INSERT INTO password_resets (email, token_hash, expires_at) VALUES (?, ?, ?)').run(email, hashed, expires);

  // Route reset link to the correct subdomain: partner accounts (admin/trader)
  // can only reset on partner.sanathanatattva.shop; consumers on the main site.
  const { getConsumerSiteUrl, getPartnerSiteUrl } = require('../utils/publicUrl');
  const baseUrl  = user ? getPartnerSiteUrl() : getConsumerSiteUrl();
  const resetUrl = `${baseUrl}/reset-password?token=${raw}`;

  const response = { success: true };
  if (!process.env.EMAIL_USER) response.dev_token = raw;
  res.json(response);

  sendPasswordResetEmail(email, resetUrl).catch(err =>
    console.error('[forgot-password] email send failed:', err.message)
  );
});

/* ── POST /reset-password ──────────────────────────────────────────────── */
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('new_password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { token, new_password } = req.body;
  const hashed = crypto.createHash('sha256').update(String(token)).digest('hex');

  const record = db.prepare(`
    SELECT * FROM password_resets
    WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')
  `).get(hashed);

  if (!record) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });

  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(record.id);

  const newHash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users     SET password = ? WHERE email = ?').run(newHash, record.email);
  db.prepare('UPDATE consumers SET password = ? WHERE email = ?').run(newHash, record.email);

  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   CONSUMER ACCOUNT DELETION
   Google Play "Data deletion" requirement + DPDP Act right to erasure.
   Email-token flow, deliberately login-free (a consumer without an
   active session must still be able to request this). Three steps:

     1. POST /consumer/account-deletion/request  { email }
        Always returns a generic success — never reveals whether the
        email exists. Emails a confirmation link if it does.

     2. GET  /consumer/account-deletion/verify?token=xxx
        Read-only. Resolves the token to a masked email for display.
        Safe even if an email client's link-scanner prefetches it —
        it never mutates anything.

     3. POST /consumer/account-deletion/confirm  { token }
        The actual destructive step. Only called when the person
        clicks an explicit "Yes, delete my account" button on the
        confirmation screen. Anonymises the account (see
        accountDeletionService.js for why this isn't a hard delete).
   ══════════════════════════════════════════════════════════════ */
router.post('/consumer/account-deletion/request', [
  body('email').trim().isEmail().withMessage('Enter a valid email address').normalizeEmail(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  try {
    await accountDeletion.requestDeletion(req.body.email);
  } catch (err) {
    console.error('[account-deletion/request] error:', err.message);
    // Fall through to the generic response — don't leak internal errors
    // to a public, login-free endpoint.
  }
  res.json({ success: true, message: 'If an account exists with that email, we\'ve sent a confirmation link.' });
});

router.get('/consumer/account-deletion/verify', (req, res) => {
  const result = accountDeletion.verifyToken(req.query.token);
  if (!result.valid) return res.status(400).json({ valid: false, error: 'This link is invalid or has expired. Please request a new one.' });
  res.json(result);
});

router.post('/consumer/account-deletion/confirm', [
  body('token').notEmpty().withMessage('Missing deletion token'),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  try {
    const result = accountDeletion.confirmDeletion(req.body.token);
    res.json(result);
  } catch (err) {
    if (err.code === 'INVALID_TOKEN') return res.status(400).json({ error: err.message });
    console.error('[account-deletion/confirm] error:', err.message);
    res.status(500).json({ error: 'Something went wrong deleting your account. Please try again or contact support.' });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /consumer/google
   Firebase Google sign-in. Frontend authenticates with Google via
   Firebase, sends us the ID token, we verify it server-side, then
   either log the user in (matched google_uid or email) or create a
   new consumer row.

   Does NOT require email_verified — Google has already verified the
   email. Does NOT trigger the email OTP flow.

   New Google signups don't have a phone yet — they'll be prompted
   for one at checkout (saved into consumer.phone there).
   ══════════════════════════════════════════════════════════════ */
router.post('/consumer/google', [
  body('id_token').notEmpty().withMessage('id_token is required'),
  body('referral_code').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  let decoded;
  try {
    decoded = await verifyFirebaseToken(req.body.id_token);
  } catch (err) {
    console.error('[consumer/google] token verify failed:', err.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const googleUid = decoded.uid;
  const email     = decoded.email ? String(decoded.email).toLowerCase() : null;
  const name      = decoded.name || (email ? email.split('@')[0] : 'Google User');

  if (!email) return res.status(400).json({ error: 'Google account has no email' });

  // 1) Match by google_uid (returning user)
  let consumer = db.prepare('SELECT * FROM consumers WHERE google_uid = ?').get(googleUid);

  // 2) Auto-merge: match by email
  if (!consumer) {
    consumer = db.prepare('SELECT * FROM consumers WHERE email = ?').get(email);
    if (consumer) {
      db.prepare(`UPDATE consumers SET google_uid = ?, email_verified = 1 WHERE id = ?`)
        .run(googleUid, consumer.id);
      consumer.google_uid = googleUid;
      consumer.email_verified = 1;
    }
  }

  // 3) New consumer
  if (!consumer) {
    let linkedDealerId = null, usedCode = null;
    const refCode = (req.body.referral_code || '').trim().toUpperCase();
    if (refCode) {
      const dealer = db.prepare(
        `SELECT id FROM users WHERE referral_code = ? AND role='trader' AND status='active'`
      ).get(refCode);
      if (dealer) { linkedDealerId = dealer.id; usedCode = refCode; }
    }

    const result = db.prepare(`
      INSERT INTO consumers
        (name, email, google_uid, password, phone, referral_code_used, linked_dealer_id, email_verified, status)
      VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, 'active')
    `).run(name, email, googleUid, usedCode, linkedDealerId);

    consumer = db.prepare('SELECT * FROM consumers WHERE id = ?').get(result.lastInsertRowid);
  }

  if (consumer.status !== 'active') {
    return res.status(403).json({ error: 'Account suspended.' });
  }

  res.json({
    token: signConsumerToken(consumer.id),
    consumer: safeConsumer(consumer),
    needs_phone: !consumer.phone,
  });
});

module.exports = router;
