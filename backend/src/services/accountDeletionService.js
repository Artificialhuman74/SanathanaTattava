/**
 * Consumer account deletion (Google Play "Data deletion" requirement +
 * DPDP Act 2023 right-to-erasure).
 *
 * Email-token flow, same shape as the password-reset flow: request →
 * emailed link → explicit confirm click. Deliberately login-free — a
 * consumer who lost access to their device/session must still be able
 * to request deletion from any browser, which is exactly what Play's
 * policy expects from the public web page.
 *
 * IMPORTANT — this ANONYMISES, it does not hard-delete the consumers
 * row. `foreign_keys = ON` (db.js) means consumer_orders,
 * container_holdings, consumer_store_credit_ledger, and
 * container_finance_log all hold a NOT NULL reference to consumers.id
 * with no ON DELETE CASCADE — a hard delete would throw a constraint
 * error, and even if it didn't, wiping those rows would corrupt admin
 * financial reports, trader commission history, and container-deposit
 * accounting for money that has already moved. Anonymising the
 * identifying fields while keeping the row satisfies both the "delete
 * my account" request and the 8-year tax record-keeping obligation
 * disclosed in the Privacy Policy (Legal page, clause 2.04) — this is
 * the standard, GDPR/DPDP-compliant "erasure with legal retention
 * carve-out" pattern.
 *
 * What's removed: name, email, phone, address, password, Google
 * identity, saved delivery addresses, and the display name on any
 * product reviews they wrote (the review content/rating stays — it's
 * useful, anonymised feedback, same as "Amazon Customer" reviews).
 *
 * What's retained, anonymised: consumer_orders, commissions,
 * container_holdings, consumer_store_credit_ledger — required for GST
 * / Income Tax record-keeping (8 years) and to keep other people's
 * financial reports (trader commissions, admin finance) accurate.
 */
const crypto = require('crypto');
const db = require('../database/db');
const {
  sendAccountDeletionConfirmEmail,
  sendAccountDeletedEmail,
} = require('./emailService');
const { getConsumerSiteUrl } = require('../utils/publicUrl');

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

/**
 * Step 1: request deletion by email. Always resolves without revealing
 * whether the email exists (same anti-enumeration posture as
 * /forgot-password). Fires the confirmation email asynchronously.
 */
async function requestDeletion(email) {
  const consumer = db.prepare(
    `SELECT id, name FROM consumers WHERE email = ? AND status != 'deleted'`
  ).get(email);

  if (!consumer) return { queued: false }; // caller still returns a generic success

  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  // Invalidate any earlier unused requests for this consumer first.
  db.prepare(`UPDATE consumer_deletion_requests SET used = 1 WHERE consumer_id = ? AND used = 0`)
    .run(consumer.id);
  db.prepare(
    `INSERT INTO consumer_deletion_requests (consumer_id, token_hash, expires_at) VALUES (?, ?, ?)`
  ).run(consumer.id, tokenHash, expiresAt);

  const confirmUrl = `${getConsumerSiteUrl()}/shop/legal?deletion_token=${raw}#delete-account`;
  sendAccountDeletionConfirmEmail(email, confirmUrl).catch(err =>
    console.error('[account-deletion] confirm email failed:', err.message)
  );

  return { queued: true };
}

/**
 * Step 2 (safe, read-only): resolve a token to a masked email for the
 * confirmation screen. Never mutates anything — safe even if an email
 * client's link-scanner prefetches it.
 */
function verifyToken(rawToken) {
  const tokenHash = hashToken(String(rawToken || ''));
  const record = db.prepare(`
    SELECT r.id, c.email FROM consumer_deletion_requests r
    JOIN consumers c ON c.id = r.consumer_id
    WHERE r.token_hash = ? AND r.used = 0 AND r.expires_at > datetime('now')
  `).get(tokenHash);

  if (!record) return { valid: false };
  return { valid: true, maskedEmail: maskEmail(record.email) };
}

/**
 * Step 3 (destructive, requires an explicit user click on the
 * frontend): validate the token again, then anonymise the account in
 * one transaction.
 */
function confirmDeletion(rawToken) {
  const tokenHash = hashToken(String(rawToken || ''));
  const record = db.prepare(`
    SELECT r.id, r.consumer_id, c.email, c.name FROM consumer_deletion_requests r
    JOIN consumers c ON c.id = r.consumer_id
    WHERE r.token_hash = ? AND r.used = 0 AND r.expires_at > datetime('now')
  `).get(tokenHash);

  if (!record) {
    const err = new Error('This deletion link is invalid or has expired. Please request a new one.');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  const { consumer_id: consumerId, email: originalEmail, name: originalName } = record;
  const anonEmail = `deleted-${consumerId}-${Date.now()}@deleted.sanathanatattva.shop`;
  const anonPhone = `deleted-${consumerId}-${Date.now()}`;
  const unusablePasswordHash = crypto.randomBytes(32).toString('hex');

  db.transaction(() => {
    db.prepare(`
      UPDATE consumers
         SET name = 'Deleted User',
             email = ?,
             phone = ?,
             password = ?,
             address = NULL,
             pincode = NULL,
             google_uid = NULL,
             status = 'deleted'
       WHERE id = ?
    `).run(anonEmail, anonPhone, unusablePasswordHash, consumerId);

    db.prepare(`DELETE FROM consumer_addresses WHERE consumer_id = ?`).run(consumerId);

    // Reviews keep their content/rating (useful, anonymised feedback) but
    // lose the display name — it's a denormalised snapshot column, not a
    // live join, so it must be updated explicitly.
    db.prepare(`UPDATE product_reviews SET consumer_name = 'Deleted User' WHERE consumer_id = ?`)
      .run(consumerId);

    db.prepare(`UPDATE consumer_deletion_requests SET used = 1 WHERE id = ?`).run(record.id);
  })();

  sendAccountDeletedEmail(originalEmail, originalName).catch(err =>
    console.error('[account-deletion] final confirmation email failed:', err.message)
  );

  return { success: true };
}

module.exports = { requestDeletion, verifyToken, confirmDeletion };
