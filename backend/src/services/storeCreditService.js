/**
 * Store credit wallet — Phase 7
 *
 * Append-only ledger keyed by consumer. Refunds (positive delta) are written
 * by containerHoldingsService.finalizeRefund; redemptions (negative delta)
 * are written here by applyStoreCredit at checkout.
 *
 *   balance = SUM(delta)
 *
 * No row is ever updated or deleted. Reversals are themselves new rows.
 */

const db = require('../database/db');

function getBalance(consumerId) {
  const r = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) AS balance
      FROM consumer_store_credit_ledger
     WHERE consumer_id=?
  `).get(consumerId);
  return r ? Number(r.balance) : 0;
}

/* Balance net of credit already reserved by orders that exist but haven't
 * been paid yet. Used at checkout to stop double-spend across multiple
 * open carts. */
function getAvailableBalance(consumerId) {
  const balance = getBalance(consumerId);
  const r = db.prepare(`
    SELECT COALESCE(SUM(store_credit_applied), 0) AS reserved
      FROM consumer_orders
     WHERE consumer_id=?
       AND payment_status != 'paid'
       AND status != 'cancelled'
  `).get(consumerId);
  return Math.max(0, balance - Number(r.reserved));
}

function getLedger(consumerId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT id, delta, reason, source_type, source_id, created_at
      FROM consumer_store_credit_ledger
     WHERE consumer_id=?
     ORDER BY id DESC
     LIMIT ?
  `).all(consumerId, limit);
}

/* Redeem credit against an order. Inserts a single negative ledger row.
 * Must be called from inside a caller-owned transaction OR with the caller
 * already validated `amount <= balance` — the SELECT/INSERT pair below is
 * not atomic on its own, so concurrent redemption is the caller's problem.
 *
 * For v1, redemption only happens at /verify (after Razorpay confirms the
 * payment), so the race window is small. We still re-validate balance here
 * as a safety net.
 */
function applyStoreCredit({ consumerId, orderId, amount, createdBy }) {
  if (!(amount > 0)) {
    const err = new Error('amount must be > 0');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }
  const balance = getBalance(consumerId);
  if (amount > balance + 1e-6) {
    const err = new Error(`insufficient store credit: have ₹${balance.toFixed(2)}, asked ₹${amount.toFixed(2)}`);
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }
  const r = db.prepare(`
    INSERT INTO consumer_store_credit_ledger
      (consumer_id, delta, reason, source_type, source_id, created_by)
    VALUES (?, ?, ?, 'order_redemption', ?, ?)
  `).run(
    consumerId,
    -Math.abs(amount),
    `Applied to order #${orderId}`,
    orderId,
    createdBy || null,
  );
  return { ledgerId: r.lastInsertRowid, balanceAfter: balance - amount };
}

/* List of refunded+manual_bank holdings still awaiting a UTR. Admins use
 * this as their payout queue. */
function getPendingManualRefunds() {
  return db.prepare(`
    SELECT h.id, h.consumer_id, h.deposit_amount, h.container_type,
           h.resolved_at, h.refund_destination, h.notes,
           c.name  AS consumer_name,
           c.phone AS consumer_phone,
           c.email AS consumer_email,
           u_dealer.name AS linked_dealer_name,
           (SELECT a.address || ', ' || a.pincode FROM consumer_addresses a
             WHERE a.consumer_id=c.id AND a.is_default=1 LIMIT 1) AS consumer_address
      FROM container_holdings h
      JOIN consumers c        ON c.id = h.consumer_id
      LEFT JOIN users u_dealer ON u_dealer.id = c.linked_dealer_id
     WHERE h.status='refunded'
       AND h.refund_destination='manual_bank'
       AND h.manual_refund_utr IS NULL
     ORDER BY h.resolved_at ASC, h.id ASC
  `).all();
}

/* Stamp a UTR on a manual_bank refund. Idempotent guard: refuses if a UTR
 * is already present. */
function settleManualRefund({ holdingId, utr, notes, paidByUserId }) {
  if (!utr || typeof utr !== 'string' || utr.trim().length < 4) {
    const err = new Error('utr must be a non-empty string of at least 4 chars');
    err.code = 'INVALID_UTR';
    throw err;
  }
  const row = db.prepare(`
    SELECT id, status, refund_destination, manual_refund_utr
      FROM container_holdings WHERE id=?
  `).get(holdingId);
  if (!row) {
    const err = new Error('holding not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (row.status !== 'refunded' || row.refund_destination !== 'manual_bank') {
    const err = new Error(`cannot settle: status=${row.status} destination=${row.refund_destination}`);
    err.code = 'INVALID_STATUS';
    throw err;
  }
  if (row.manual_refund_utr) {
    const err = new Error(`already settled with UTR ${row.manual_refund_utr}`);
    err.code = 'ALREADY_SETTLED';
    throw err;
  }
  db.prepare(`
    UPDATE container_holdings
       SET manual_refund_utr=?,
           manual_refund_paid_at=CURRENT_TIMESTAMP,
           manual_refund_paid_by=?,
           notes=COALESCE(? || char(10) || COALESCE(notes,''), notes),
           updated_at=CURRENT_TIMESTAMP
     WHERE id=?
  `).run(utr.trim(), paidByUserId || null, notes || null, holdingId);
  return { ok: true, utr: utr.trim() };
}

module.exports = {
  getBalance,
  getAvailableBalance,
  getLedger,
  applyStoreCredit,
  getPendingManualRefunds,
  settleManualRefund,
};
