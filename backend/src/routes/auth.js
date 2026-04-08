const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');

const router = express.Router();

const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

/* ── Referral Code Generation ─────────────────────────────────────────
 *  Tier 1: A0000, B0000, C0000 … (next unused uppercase letter + "0000")
 *  Tier 2: A0001, A0002 …       (parent's letter + next number under that parent)
 */
function generateTier1Code() {
  const used = db.prepare(`SELECT referral_code FROM users WHERE role='trader' AND tier=1`)
    .all().map(r => r.referral_code && r.referral_code[0]).filter(Boolean);
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
    if (!used.includes(letter)) return `${letter}0000`;
  }
  return `T${Date.now().toString().slice(-4)}`; // fallback
}

function generateTier2Code(parentId) {
  const parent = db.prepare(`SELECT referral_code FROM users WHERE id=?`).get(parentId);
  if (!parent?.referral_code) return null;
  const prefix = parent.referral_code[0]; // e.g. 'A'
  const existingNums = db.prepare(`SELECT referral_code FROM users WHERE role='trader' AND tier=2 AND referral_code LIKE ?`)
    .all(`${prefix}%`)
    .map(r => r.referral_code ? parseInt(r.referral_code.slice(1)) : 0)
    .filter(n => !isNaN(n) && n > 0);
  const next = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/* ── Trader / Admin Login ─────────────────────────────────────────────── */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is suspended' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  delete user.password;
  res.json({ token: signToken(user.id, user.role), user });
});

/* ── Trader Register ──────────────────────────────────────────────────── */
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
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
    return res.status(409).json({ error: 'Email already registered' });

  let tier = 1, referredById = null, code = null;

  if (referralCode && referralCode.trim()) {
    const referrer = db.prepare(`SELECT * FROM users WHERE referral_code = ? AND role='trader' AND tier=1 AND status='active'`).get(referralCode.trim());
    if (!referrer) return res.status(400).json({ error: 'Invalid referral code. Only Tier 1 (e.g. A0000) codes are accepted.' });
    tier = 2;
    referredById = referrer.id;
    code = generateTier2Code(referrer.id);
    if (!code) return res.status(500).json({ error: 'Could not generate sub-dealer code' });
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) {
      // increment until unique (collision safety)
      const num = parseInt(code.slice(1)) + 1;
      code = `${code[0]}${String(num).padStart(4,'0')}`;
    }
  } else {
    code = generateTier1Code();
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) {
      // Should not happen, but just in case
      const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(code[0]) + 1;
      code = `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[idx] || 'Z'}0000`;
    }
  }

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

/** Generate a raw token and store its SHA-256 hash in email_verifications */
function createVerificationToken(email) {
  const raw  = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE email_verifications SET used = 1 WHERE email = ?').run(email);
  db.prepare('INSERT INTO email_verifications (email, token_hash, expires_at) VALUES (?, ?, ?)').run(email, hash, expires);
  return raw;
}

/** Build the verification URL sent in emails */
function verifyUrl(rawToken) {
  const base = process.env.FRONTEND_URL || 'https://sanathanatattva.shop';
  return `${base}/shop/verify-email?token=${rawToken}`;
}

/* ── POST /consumer/register ──────────────────────────────── */
router.post('/consumer/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('referral_code').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { name, email, password, referral_code } = req.body;

  if (db.prepare('SELECT id FROM consumers WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Email already registered. Please log in.' });

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
    VALUES (?, ?, ?, '', ?, ?, 0, 'active')
  `).run(name, email, hash, usedCode, linkedDealerId);

  const rawToken = createVerificationToken(email);

  let mailResult = { dev: true };
  try {
    mailResult = await sendVerificationEmail(email, verifyUrl(rawToken));
  } catch (mailErr) {
    console.error('[register] email send failed:', mailErr.message);
    // Account is created even if email fails; user can resend
  }

  const response = { success: true, message: 'Account created. Please verify your email.' };
  if (mailResult.dev) response.dev_token = rawToken;
  res.status(201).json(response);
});

/* ── GET /consumer/verify-email ───────────────────────────── */
router.get('/consumer/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const hash   = crypto.createHash('sha256').update(String(token)).digest('hex');
  const record = db.prepare(`
    SELECT * FROM email_verifications
    WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')
  `).get(hash);

  if (!record) return res.status(400).json({ error: 'Invalid or expired verification link. Please request a new one.' });

  db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(record.id);
  db.prepare('UPDATE consumers SET email_verified = 1 WHERE email = ?').run(record.email);

  const consumer = db.prepare('SELECT * FROM consumers WHERE email = ?').get(record.email);
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

  const rawToken = createVerificationToken(email);
  let mailResult = { dev: true };
  try {
    mailResult = await sendVerificationEmail(email, verifyUrl(rawToken));
  } catch (mailErr) {
    console.error('[resend] email send failed:', mailErr.message);
  }

  const response = { success: true };
  if (mailResult.dev) response.dev_token = rawToken;
  res.json(response);
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
  if (!consumer) return res.status(401).json({ error: 'Invalid email or password.' });
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

  const base     = process.env.FRONTEND_URL || 'https://sanathanatattva.shop';
  const resetUrl = `${base}/reset-password?token=${raw}`;
  let mailResult = { dev: true };
  try {
    mailResult = await sendPasswordResetEmail(email, resetUrl);
  } catch (mailErr) {
    console.error('[forgot-password] email send failed:', mailErr.message);
  }

  const response = { success: true };
  if (mailResult.dev) response.dev_token = raw;
  res.json(response);
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

module.exports = router;
