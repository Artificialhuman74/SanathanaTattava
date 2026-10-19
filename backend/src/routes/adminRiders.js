/**
 * Admin review of rider applications (ST Partner app, handoff §4.14).
 *
 *   GET  /api/admin/riders?status=pending_review   list + counts per status
 *   GET  /api/admin/riders/:id                     everything the rider sent
 *   GET  /api/admin/riders/:id/kyc/:kind           a private KYC photo (admins only; ?size=thumb for the small copy)
 *   POST /api/admin/riders/:id/review              approve, or send back with a reason per item
 */
const express = require('express');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/auditLog');
const { KYC_FIELDS, kycFilePath } = require('../services/kycStorage');
const { parseReviewIssues } = require('../services/riderApplication');
const { sendToUser } = require('../services/pushService');

const router = express.Router();
router.use(authenticate, requireAdmin);

const STATUSES = ['pending_review', 'approved', 'rejected'];

function issuesOf(row) {
  try { return row.review_issues ? JSON.parse(row.review_issues) : []; } catch (_) { return []; }
}

router.get('/', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending_review';
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db.prepare(`SELECT review_status, COUNT(*) AS n FROM users WHERE role = 'rider' GROUP BY review_status`).all()) {
    if (row.review_status in counts) counts[row.review_status] = row.n;
  }
  const riders = db.prepare(`
    SELECT u.id, u.name, u.phone, u.email, u.vehicle_type, u.vehicle_plate,
           u.review_status, u.review_submitted_at, u.reviewed_at, u.created_at,
           a.label AS base_label, a.address AS base_address
    FROM users u
    LEFT JOIN user_addresses a ON a.user_id = u.id AND a.is_default = 1
    WHERE u.role = 'rider' AND u.review_status = ?
    ORDER BY u.review_submitted_at ASC
  `).all(status).map((r) => ({
    ...r,
    // Sent back once and fixed: the admin should look at the flagged items first.
    resubmitted: r.review_status === 'pending_review' && !!r.reviewed_at,
  }));
  res.json({ status, counts, riders });
});

router.get('/:id', (req, res) => {
  const rider = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'rider'`).get(req.params.id);
  if (!rider) return res.status(404).json({ error: 'Rider not found' });
  const base = db.prepare(
    'SELECT label, address, latitude, longitude FROM user_addresses WHERE user_id = ? AND is_default = 1',
  ).get(rider.id);
  res.json({
    rider: {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      email: rider.email,
      created_at: rider.created_at,
      review_status: rider.review_status,
      review_issues: issuesOf(rider),
      review_submitted_at: rider.review_submitted_at,
      reviewed_at: rider.reviewed_at,
      vehicle_type: rider.vehicle_type,
      vehicle_plate: rider.vehicle_plate,
      licence_number: rider.licence_number,
      pan: rider.pan,
      bank_account_name: rider.bank_account_name,
      bank_account_number: rider.bank_account_number,
      bank_ifsc: rider.bank_ifsc,
      emergency_name: rider.emergency_name,
      emergency_relation: rider.emergency_relation,
      emergency_phone: rider.emergency_phone,
      base: base || null,
      photos: Object.fromEntries(Object.entries(KYC_FIELDS).map(([kind, column]) => [kind, !!rider[column]])),
    },
  });
});

router.get('/:id/kyc/:kind', (req, res) => {
  const column = KYC_FIELDS[req.params.kind];
  if (!column) return res.status(404).json({ error: 'Unknown document' });
  const rider = db.prepare(`SELECT ${column} AS file FROM users WHERE id = ? AND role = 'rider'`).get(req.params.id);
  const full = rider && kycFilePath(rider.file, req.query.size === 'thumb' ? 'thumb' : 'full');
  if (!full) return res.status(404).json({ error: 'Photo not found' });
  // Identity documents: never cached by a browser, proxy or CDN.
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('image/webp').sendFile(full);
});

router.post('/:id/review', auditLog('rider-review'), (req, res) => {
  const rider = db.prepare(`SELECT id, review_status FROM users WHERE id = ? AND role = 'rider'`).get(req.params.id);
  if (!rider) return res.status(404).json({ error: 'Rider not found' });
  if (rider.review_status !== 'pending_review') {
    return res.status(409).json({ error: 'This application is not waiting for review' });
  }
  const { decision } = req.body || {};
  if (decision === 'approve') {
    db.prepare(`
      UPDATE users SET review_status = 'approved', review_issues = NULL,
        reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.user.id, rider.id);
    sendToUser(rider.id, {
      title: 'You’re approved!',
      body: 'Welcome to ST Partner. Open the app to turn on order alerts.',
      data: { type: 'rider_review', review_status: 'approved' },
    });
    return res.json({ id: rider.id, review_status: 'approved' });
  }
  if (decision === 'reject') {
    const { issues, error } = parseReviewIssues(req.body.issues);
    if (error) return res.status(400).json({ error });
    db.prepare(`
      UPDATE users SET review_status = 'rejected', review_issues = ?,
        reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(issues), req.user.id, rider.id);
    sendToUser(rider.id, {
      title: issues.length === 1 ? 'One thing needs fixing' : `${issues.length} things need fixing`,
      body: 'Open ST Partner to see what to fix, then send your profile again.',
      data: { type: 'rider_review', review_status: 'rejected' },
    });
    return res.json({ id: rider.id, review_status: 'rejected', review_issues: issues });
  }
  return res.status(400).json({ error: 'decision must be approve or reject' });
});

module.exports = router;
