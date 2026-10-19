/**
 * Outside delivery riders — signup and application status for the ST Partner app.
 *
 *   POST /api/rider/register          email + password signup (multipart, with KYC photos)
 *   POST /api/rider/register/google   same, identity from a Firebase Google ID token
 *   GET  /api/rider/application       the signed-in rider's review status + what they sent
 *   PUT  /api/rider/application       fix the items an admin sent back, then resend
 *
 * New riders can log in straight away (status='active'), but stay
 * review_status='pending_review' until an admin approves them in
 * /api/admin/riders. Rider accounts have role='rider', so every trader-only
 * route keeps refusing them.
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { verifyIdToken: verifyFirebaseToken } = require('../services/firebaseAdmin');
const { latLngToH3Index } = require('../services/h3Service');
const { KYC_FIELDS, ALLOWED_MIME, saveKycImage, removeKycFile } = require('../services/kycStorage');
const { validateApplication, completenessErrors } = require('../services/riderApplication');

const router = express.Router();

/* Must match the sentinel in routes/auth.js: Google-only accounts have no password. */
const GOOGLE_ONLY_PASSWORD = 'GOOGLE_SIGNIN_NO_PASSWORD';

const signToken = (id, role) => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Photos must be JPEG, PNG, WebP or HEIC'));
    cb(null, true);
  },
}).fields(Object.keys(KYC_FIELDS).map((name) => ({ name, maxCount: 1 })));

const withPhotos = (req, res, next) =>
  upload(req, res, (err) => (err ? res.status(400).json({ error: err.message || 'Upload failed' }) : next()));

const fail = (res, status, errors) =>
  res.status(status).json({ error: Object.values(errors)[0], fields: errors });

/** Saves every photo that came in; returns { column: filename }. Cleans up if one fails. */
async function storePhotos(files = {}) {
  const saved = {};
  try {
    for (const [field, column] of Object.entries(KYC_FIELDS)) {
      const file = files[field] && files[field][0];
      if (file) saved[column] = await saveKycImage(file.buffer);
    }
    return saved;
  } catch (err) {
    Object.values(saved).forEach(removeKycFile);
    throw err;
  }
}

function safeUser(user) {
  if (!user) return user;
  const { password, ...rest } = user;
  return rest;
}

function setDefaultBase(userId, values) {
  let h3 = null;
  try { h3 = latLngToH3Index(values.base_lat, values.base_lng); } catch (_) {}
  db.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').run(userId);
  db.prepare(`
    INSERT INTO user_addresses (user_id, label, address, latitude, longitude, h3_index, is_default)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(userId, values.base_label, values.base_address, values.base_lat, values.base_lng, h3);
  // Mirrored on the user row, where dispatch already looks for a partner's location.
  db.prepare('UPDATE users SET address = ?, latitude = ?, longitude = ?, h3_index = ? WHERE id = ?')
    .run(values.base_address, values.base_lat, values.base_lng, h3, userId);
}

/** Shared by both signup routes once identity is settled. */
async function createRider(res, values, files, identity) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR (google_uid IS NOT NULL AND google_uid = ?)')
    .get(identity.email, identity.googleUid || null);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
  }

  const record = { ...values, kyc_licence_front: files.licence_front ? 'x' : null, kyc_licence_back: files.licence_back ? 'x' : null };
  const crossErrors = completenessErrors(record);
  if (crossErrors) return fail(res, 400, crossErrors);

  let photos;
  try {
    photos = await storePhotos(files);
  } catch (err) {
    console.error('[rider/register] photo processing failed:', err.message);
    return res.status(400).json({ error: 'Could not read one of the photos. Please take it again.' });
  }

  const motor = values.vehicle_type === 'scooter' || values.vehicle_type === 'bike';
  try {
    const userId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (
          name, email, password, google_uid, role, phone, status,
          review_status, review_submitted_at,
          vehicle_type, vehicle_plate, licence_number,
          pan, bank_account_name, bank_account_number, bank_ifsc,
          emergency_name, emergency_relation, emergency_phone,
          kyc_selfie, kyc_licence_front, kyc_licence_back, kyc_pan
        ) VALUES (?, ?, ?, ?, 'rider', ?, 'active', 'pending_review', CURRENT_TIMESTAMP,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        values.name, identity.email, identity.passwordHash, identity.googleUid || null, values.phone,
        values.vehicle_type, motor ? values.vehicle_plate : null, motor ? values.licence_number : null,
        values.pan, values.bank_account_name, values.bank_account_number, values.bank_ifsc,
        values.emergency_name, values.emergency_relation, values.emergency_phone,
        photos.kyc_selfie || null, motor ? photos.kyc_licence_front || null : null,
        motor ? photos.kyc_licence_back || null : null, photos.kyc_pan || null,
      );
      setDefaultBase(result.lastInsertRowid, values);
      return result.lastInsertRowid;
    })();
    // Licence photos sent for a walking/cycle rider aren't kept.
    if (!motor) [photos.kyc_licence_front, photos.kyc_licence_back].forEach(removeKycFile);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return res.status(201).json({ token: signToken(user.id, user.role), user: safeUser(user) });
  } catch (err) {
    Object.values(photos).forEach(removeKycFile);
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
    }
    console.error('[rider/register] insert failed:', err.message);
    return res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
}

/* ── Signup ───────────────────────────────────────────────────────────── */

router.post('/register', withPhotos, async (req, res) => {
  const { values, errors } = validateApplication(req.body, req.files, { mode: 'new', withPassword: true });
  if (errors) return fail(res, 400, errors);
  const passwordHash = await bcrypt.hash(values.password, 12);
  return createRider(res, values, req.files || {}, { email: values.email, passwordHash });
});

router.post('/register/google', withPhotos, async (req, res) => {
  if (!req.body.id_token) return res.status(400).json({ error: 'id_token is required' });
  let decoded;
  try {
    decoded = await verifyFirebaseToken(req.body.id_token);
  } catch (err) {
    console.error('[rider/register/google] token verify failed:', err.message);
    return res.status(401).json({ error: 'Google sign-in expired. Please try again.' });
  }
  const email = decoded.email ? String(decoded.email).toLowerCase().trim() : null;
  if (!email) return res.status(400).json({ error: 'Google account has no email' });

  const { values, errors } = validateApplication(req.body, req.files, { mode: 'new', withPassword: false });
  if (errors) return fail(res, 400, errors);
  return createRider(res, values, req.files || {}, {
    email, googleUid: decoded.uid, passwordHash: GOOGLE_ONLY_PASSWORD,
  });
});

/* ── The rider's own application ─────────────────────────────────────── */

const requireRider = (req, res, next) =>
  (req.user.role === 'rider' ? next() : res.status(403).json({ error: 'Rider access required' }));

function applicationView(user) {
  const base = db.prepare(
    'SELECT label, address, latitude, longitude FROM user_addresses WHERE user_id = ? AND is_default = 1',
  ).get(user.id);
  let issues = [];
  try { issues = user.review_issues ? JSON.parse(user.review_issues) : []; } catch (_) {}
  return {
    review_status: user.review_status,
    review_issues: issues,
    submitted_at: user.review_submitted_at,
    reviewed_at: user.reviewed_at,
    application: {
      name: user.name,
      phone: user.phone,
      email: user.email,
      base: base || null,
      vehicle_type: user.vehicle_type,
      vehicle_plate: user.vehicle_plate,
      licence_number: user.licence_number,
      pan: user.pan,
      bank_account_name: user.bank_account_name,
      bank_account_last4: user.bank_account_number ? user.bank_account_number.slice(-4) : null,
      bank_ifsc: user.bank_ifsc,
      emergency_name: user.emergency_name,
      emergency_relation: user.emergency_relation,
      emergency_phone: user.emergency_phone,
      photos: {
        selfie: !!user.kyc_selfie,
        licence_front: !!user.kyc_licence_front,
        licence_back: !!user.kyc_licence_back,
        pan_photo: !!user.kyc_pan,
      },
    },
  };
}

router.get('/application', authenticate, requireRider, (req, res) => {
  res.json(applicationView(req.user));
});

router.put('/application', authenticate, requireRider, withPhotos, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.review_status !== 'rejected') {
    return res.status(409).json({ error: 'Your application is not waiting for changes.' });
  }
  const { values, errors } = validateApplication(req.body, req.files, { mode: 'update' });
  if (errors) return fail(res, 400, errors);

  let photos;
  try {
    photos = await storePhotos(req.files || {});
  } catch (err) {
    return res.status(400).json({ error: 'Could not read one of the photos. Please take it again.' });
  }

  const merged = { ...user, ...values, ...photos };
  const motor = merged.vehicle_type === 'scooter' || merged.vehicle_type === 'bike';
  const crossErrors = completenessErrors(merged);
  if (crossErrors) {
    Object.values(photos).forEach(removeKycFile);
    return fail(res, 400, crossErrors);
  }

  const columns = [
    'name', 'phone', 'vehicle_type', 'vehicle_plate', 'licence_number',
    'pan', 'bank_account_name', 'bank_account_number', 'bank_ifsc',
    'emergency_name', 'emergency_relation', 'emergency_phone',
    'kyc_selfie', 'kyc_licence_front', 'kyc_licence_back', 'kyc_pan',
  ];
  const next = Object.fromEntries(columns.map((c) => [c, merged[c] ?? null]));
  if (!motor) Object.assign(next, { vehicle_plate: null, licence_number: null, kyc_licence_front: null, kyc_licence_back: null });

  db.transaction(() => {
    db.prepare(`
      UPDATE users SET ${columns.map((c) => `${c} = @${c}`).join(', ')},
        review_status = 'pending_review', review_issues = NULL, review_submitted_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...next, id: user.id });
    if (values.base_address !== undefined) setDefaultBase(user.id, values);
  })();

  // Old photos that were replaced (or dropped with the licence) aren't needed any more.
  for (const column of Object.values(KYC_FIELDS)) {
    if (user[column] && user[column] !== next[column]) removeKycFile(user[column]);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json(applicationView(updated));
});

module.exports = router;
