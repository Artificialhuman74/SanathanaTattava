const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { sendOtpEmail, DEV_MODE } = require('../services/emailService');

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
   CONSUMER AUTH  — OTP-based (no passwords)
   Flow:
     Register: POST /consumer/send-otp (with name, email)
               POST /consumer/verify-otp  → { needs_registration, phone_verified_token }
               POST /consumer/complete-registration (new users only)
     Login:    POST /consumer/send-otp (phone only)
               POST /consumer/verify-otp  → { token, consumer }
══════════════════════════════════════════════════════════════ */

/* ── Helpers ──────────────────────────────────────────────── */
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signConsumerToken(id) {
  return jwt.sign({ id, role: 'consumer' }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function signPhoneVerifiedToken(phone, email) {
  return jwt.sign({ phone, email: email || null, type: 'phone_verified' }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function safeConsumer(c) {
  const obj = { ...c };
  delete obj.password;
  return obj;
}

/* ── POST /consumer/send-otp ──────────────────────────────── */
router.post('/consumer/send-otp', [
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional({ nullable: true }).isEmail().normalizeEmail().withMessage('Valid email required if provided'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const phone = req.body.phone.trim();
  let email   = req.body.email || null;

  // Look up existing consumer
  const existing = db.prepare('SELECT * FROM consumers WHERE phone = ?').get(phone);

  if (existing) {
    // Login path — use stored email if available
    email = existing.email || email || null;
    if (!email && !DEV_MODE) return res.status(400).json({ error: 'No email on file. Please register again.' });
  } else {
    // Registration path — email is optional (dev mode shows OTP on screen; prod uses SMS)
    if (email) {
      const emailTaken = db.prepare('SELECT id FROM consumers WHERE email = ? AND phone != ?').get(email, phone);
      if (emailTaken) return res.status(409).json({ error: 'Email already in use by another account.' });
    }
    if (!email && !DEV_MODE) {
      return res.status(400).json({ error: 'Email is required for registration in production mode.' });
    }
  }

  // Rate limit: max 3 OTPs per phone in last 10 minutes
  const recentCount = db.prepare(`
    SELECT COUNT(*) as c FROM consumer_otps
    WHERE phone = ? AND created_at > datetime('now', '-10 minutes')
  `).get(phone).c;
  if (recentCount >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  const otp     = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Store empty string when no email (NOT NULL column, email is optional in dev mode)
  db.prepare(`INSERT INTO consumer_otps (phone, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .run(phone, email || '', otpHash, expires);

  const result = email ? await sendOtpEmail(email, phone, otp) : { dev: true };

  const response = { success: true, is_new_user: !existing };
  if (email) response.email_masked = email.replace(/(.{2}).+(@.+)/, '$1***$2');
  if (result.dev || DEV_MODE) response.dev_otp = otp;

  res.json(response);
});

/* ── POST /consumer/verify-otp ────────────────────────────── */
router.post('/consumer/verify-otp', [
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const phone = req.body.phone.trim();
  const otp   = req.body.otp.trim();

  // Find the most recent valid, unused OTP for this phone
  const record = db.prepare(`
    SELECT * FROM consumer_otps
    WHERE phone = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(phone);

  if (!record) return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });

  // Prevent brute force — max 5 attempts per OTP record
  if (record.attempts >= 5) {
    db.prepare(`UPDATE consumer_otps SET used = 1 WHERE id = ?`).run(record.id);
    return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new OTP.' });
  }

  const valid = await bcrypt.compare(otp, record.otp_hash);
  if (!valid) {
    db.prepare(`UPDATE consumer_otps SET attempts = attempts + 1 WHERE id = ?`).run(record.id);
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  }

  // Mark OTP as used
  db.prepare(`UPDATE consumer_otps SET used = 1 WHERE id = ?`).run(record.id);

  // Check if consumer exists
  const consumer = db.prepare('SELECT * FROM consumers WHERE phone = ?').get(phone);

  if (consumer) {
    if (consumer.status !== 'active') return res.status(403).json({ error: 'Account suspended.' });
    return res.json({ token: signConsumerToken(consumer.id), consumer: safeConsumer(consumer) });
  }

  // New user — return a short-lived token to complete registration
  const phoneVerifiedToken = signPhoneVerifiedToken(phone, record.email);
  res.json({ needs_registration: true, phone_verified_token: phoneVerifiedToken, email: record.email, phone });
});

/* ── POST /consumer/complete-registration ─────────────────── */
router.post('/consumer/complete-registration', [
  body('phone_verified_token').notEmpty().withMessage('Verification token required'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('referral_code').optional({ nullable: true }).trim(),
  body('address').optional({ nullable: true }).trim(),
  body('pincode').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  let payload;
  try {
    payload = jwt.verify(req.body.phone_verified_token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Verification token expired or invalid. Please resend OTP.' });
  }
  if (payload.type !== 'phone_verified') return res.status(401).json({ error: 'Invalid token type.' });

  const { phone, email } = payload;
  const { name, referral_code, address, pincode } = req.body;

  // Double-check not already registered (race condition guard)
  if (db.prepare('SELECT id FROM consumers WHERE phone = ?').get(phone))
    return res.status(409).json({ error: 'Phone already registered. Please log in.' });

  let linkedDealerId = null, usedCode = null;
  if (referral_code && referral_code.trim()) {
    const dealer = db.prepare(`SELECT * FROM users WHERE referral_code = ? AND role='trader' AND status='active'`).get(referral_code.trim().toUpperCase());
    if (!dealer) return res.status(400).json({ error: 'Invalid referral code.' });
    linkedDealerId = dealer.id;
    usedCode       = referral_code.trim().toUpperCase();
  }

  const result = db.prepare(`
    INSERT INTO consumers (name, email, phone, address, pincode, referral_code_used, linked_dealer_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(name, email || null, phone, address || null, pincode || null, usedCode, linkedDealerId);

  const consumer = db.prepare('SELECT * FROM consumers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: signConsumerToken(consumer.id), consumer: safeConsumer(consumer) });
});

/* ── GET /consumer/validate-dealer/:code ──────────────────── */
router.get('/consumer/validate-dealer/:code', (req, res) => {
  const dealer = db.prepare(`SELECT id, name, tier FROM users WHERE referral_code = ? AND role='trader' AND status='active'`).get(req.params.code.toUpperCase());
  if (!dealer) return res.json({ valid: false });
  res.json({ valid: true, dealerName: dealer.name, tier: dealer.tier });
});

module.exports = router;
