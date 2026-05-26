/**
 * Container holdings lifecycle.
 *
 *   payment confirmed → createHoldingsForInvoice() → status='pending_delivery'
 *   delivery OTP verified → markHoldingsDelivered() → status='held'
 *   consumer opts out → status='refund_requested' (Phase 5)
 *   delivery agent inspects → 'refunded' or 'forfeited' (Phase 6)
 *
 * See CONTAINERS_FEATURE_SPEC.md for the full lifecycle and rationale.
 */

const db = require('../database/db');

/* ── Holdings creation (called from invoiceService) ──────────────────────
 * For each order_item where the product has a container_type AND the line
 * was charged a container_cost, insert one holding row per unit.
 *
 * Refill lines (Phase 4) will pass `container_cost=0` on the order item, so
 * those lines naturally produce zero holdings — they consume existing rows
 * instead of creating new ones.
 *
 * Idempotent: skips if any holding already exists for this invoice.
 */
function createHoldingsForInvoice({ invoiceId, orderId, consumerId }) {
  const existing = db.prepare(
    `SELECT 1 FROM container_holdings WHERE invoice_id=? LIMIT 1`
  ).get(invoiceId);
  if (existing) return { created: 0, skipped: true };

  const items = db.prepare(`
    SELECT oi.id AS order_item_id, oi.product_id, oi.quantity, oi.container_cost,
           p.container_type, p.name
      FROM consumer_order_items oi
      JOIN products p ON p.id=oi.product_id
     WHERE oi.order_id=? AND oi.container_cost > 0
  `).all(orderId);

  if (!items.length) return { created: 0, skipped: false };

  const insert = db.prepare(`
    INSERT INTO container_holdings
      (consumer_id, invoice_id, order_item_id, original_product_id, current_product_id,
       container_type, deposit_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_delivery')
  `);

  let created = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!it.container_type) {
        // Product wasn't tagged yet. Log and skip — admin must backfill in Inventory.
        console.warn(`[holdings] product ${it.product_id} (${it.name}) has no container_type — skipping ${it.quantity} unit(s) on invoice ${invoiceId}`);
        continue;
      }
      const perUnitDeposit = +(it.container_cost / it.quantity).toFixed(2);
      for (let q = 0; q < it.quantity; q++) {
        insert.run(
          consumerId, invoiceId, it.order_item_id,
          it.product_id, it.product_id,
          it.container_type, perUnitDeposit
        );
        created++;
      }
    }
  });
  tx();
  if (created > 0) console.log(`[holdings] invoice ${invoiceId}: created ${created} pending_delivery row(s)`);
  return { created, skipped: false };
}

/* ── Delivery confirmation (called from delivery verify-otp) ─────────────
 * Flips every pending_delivery holding for the given order to held.
 * Safe to call multiple times — only matches pending_delivery rows.
 */
function markHoldingsDelivered(orderId) {
  const result = db.prepare(`
    UPDATE container_holdings
       SET status='held',
           updated_at=CURRENT_TIMESTAMP
     WHERE invoice_id IN (SELECT id FROM invoices WHERE order_id=?)
       AND status='pending_delivery'
  `).run(orderId);
  if (result.changes > 0) {
    console.log(`[holdings] order ${orderId}: flipped ${result.changes} holding(s) to held`);
  }
  return { flipped: result.changes };
}

/* ── Read helpers (used by Phase 4+ UI) ─────────────────────────────────── */

/* Held containers for a consumer, joined with current product info. */
function getHeldContainers(consumerId) {
  return db.prepare(`
    SELECT h.id, h.invoice_id, h.order_item_id,
           h.original_product_id, h.current_product_id,
           h.container_type, h.deposit_amount, h.status,
           h.created_at, h.updated_at,
           p_cur.name  AS current_product_name,
           p_cur.unit  AS current_product_unit,
           p_orig.name AS original_product_name
      FROM container_holdings h
      JOIN products p_cur  ON p_cur.id  = h.current_product_id
      JOIN products p_orig ON p_orig.id = h.original_product_id
     WHERE h.consumer_id=? AND h.status='held'
     ORDER BY h.created_at DESC
  `).all(consumerId);
}

/* Refill cap = number of held containers the consumer has for the given
 * product, minus units already reserved in the current cart as refill lines.
 *
 * Per spec decision: pending_delivery, refund_requested, and swap statuses
 * do NOT count — only true 'held' rows.
 */
function getRefillCap({ consumerId, productId, cartReservedQty = 0 }) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n
      FROM container_holdings
     WHERE consumer_id=? AND current_product_id=? AND status='held'
  `).get(consumerId, productId);
  return Math.max(0, (row?.n || 0) - cartReservedQty);
}

/* All holdings for a consumer regardless of status — for the History tab
 * on the My Containers page. */
function getAllHoldingsForConsumer(consumerId) {
  return db.prepare(`
    SELECT h.id, h.invoice_id, h.container_type, h.deposit_amount, h.status,
           h.refund_destination, h.requested_at, h.resolved_at,
           h.notes, h.created_at, h.updated_at,
           h.damage_photo_url, h.damage_dispute_status,
           h.dispute_deadline, h.dispute_opened_at, h.dispute_resolved_at,
           p_cur.name  AS current_product_name,
           p_orig.name AS original_product_name
      FROM container_holdings h
      JOIN products p_cur  ON p_cur.id  = h.current_product_id
      JOIN products p_orig ON p_orig.id = h.original_product_id
     WHERE h.consumer_id=?
     ORDER BY h.created_at DESC
  `).all(consumerId);
}

/* ── Refund opt-out (Phase 5) ─────────────────────────────────────────────
 * Consumer asks to return a held container. We flip status to
 * 'refund_requested' and stamp the destination + timestamp. The delivery
 * agent (Phase 6) inspects on pickup and finalises as 'refunded' or
 * 'forfeited'. Until then the holding still counts as the consumer's
 * responsibility but is excluded from the refill cap.
 */
const ALLOWED_REFUND_DESTINATIONS = ['manual_bank', 'store_credit'];

function requestRefund({ holdingId, consumerId, destination, notes }) {
  if (!ALLOWED_REFUND_DESTINATIONS.includes(destination)) {
    const err = new Error(`invalid refund destination: ${destination}`);
    err.code = 'INVALID_DESTINATION';
    throw err;
  }
  const holding = db.prepare(
    `SELECT id, consumer_id, status FROM container_holdings WHERE id=?`
  ).get(holdingId);
  if (!holding || holding.consumer_id !== consumerId) {
    const err = new Error('holding not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (holding.status !== 'held') {
    const err = new Error(`cannot request refund from status=${holding.status}`);
    err.code = 'INVALID_STATUS';
    throw err;
  }
  db.prepare(`
    UPDATE container_holdings
       SET status='refund_requested',
           refund_destination=?,
           requested_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP,
           notes=COALESCE(?, notes)
     WHERE id=?
  `).run(destination, notes || null, holdingId);
  return { ok: true };
}

function cancelRefund({ holdingId, consumerId }) {
  const holding = db.prepare(
    `SELECT id, consumer_id, status FROM container_holdings WHERE id=?`
  ).get(holdingId);
  if (!holding || holding.consumer_id !== consumerId) {
    const err = new Error('holding not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (holding.status !== 'refund_requested') {
    const err = new Error(`cannot cancel from status=${holding.status}`);
    err.code = 'INVALID_STATUS';
    throw err;
  }
  db.prepare(`
    UPDATE container_holdings
       SET status='held',
           refund_destination=NULL,
           requested_at=NULL,
           updated_at=CURRENT_TIMESTAMP
     WHERE id=?
  `).run(holdingId);
  return { ok: true };
}

/* ── Swap (Phase 5, same-size only) ───────────────────────────────────────
 * Reassign a held container to a different product of the same
 * container_type. v1 ships steel-only and same-size only, so deposit_amount
 * and container_type stay constant — no payment flow needed.
 *
 * Cross-size swaps (e.g. 2.8L → 5L) require a top-up/refund and are
 * deferred to a later phase.
 */
function requestSwap({ holdingId, consumerId, targetProductId }) {
  const holding = db.prepare(`
    SELECT h.id, h.consumer_id, h.status, h.current_product_id, h.container_type
      FROM container_holdings h
     WHERE h.id=?
  `).get(holdingId);
  if (!holding || holding.consumer_id !== consumerId) {
    const err = new Error('holding not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (holding.status !== 'held') {
    const err = new Error(`cannot swap from status=${holding.status}`);
    err.code = 'INVALID_STATUS';
    throw err;
  }
  if (holding.current_product_id === targetProductId) {
    const err = new Error('target product is the same as current');
    err.code = 'NO_CHANGE';
    throw err;
  }
  const target = db.prepare(
    `SELECT id, container_type FROM products WHERE id=?`
  ).get(targetProductId);
  if (!target) {
    const err = new Error('target product not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (target.container_type !== holding.container_type) {
    const err = new Error(
      `container_type mismatch: ${holding.container_type} → ${target.container_type || 'none'}`
    );
    err.code = 'SIZE_MISMATCH';
    throw err;
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE container_holdings
         SET current_product_id=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?
    `).run(targetProductId, holdingId);
    db.prepare(`
      INSERT INTO container_swaps
        (holding_id, from_product_id, to_product_id, diff_amount, triggered_in)
      VALUES (?, ?, ?, 0, 'consumer')
    `).run(holdingId, holding.current_product_id, targetProductId);
  });
  tx();
  return { ok: true };
}

/* ── Delivery-agent finalization (Phase 6) ────────────────────────────
 * Transitions refund_requested → refunded | forfeited.
 *
 *   refunded  : container collected undamaged. If destination is
 *               store_credit we append the deposit to the consumer's
 *               ledger atomically. For manual_bank the admin processes
 *               the bank transfer offline — we just stamp the holding.
 *   forfeited : container damaged/missing. Deposit is retained.
 *               A supplementary invoice is the admin's responsibility
 *               (separate flow, not triggered here).
 *
 * Pickups for the consumer are restricted to the consumer's linked
 * dealer. Admin override is allowed (admins can resolve on behalf of a
 * dealer if needed). authorizedUserId/role come from the route layer.
 */
/* Phase 9 valid refund destinations. manual_upi is the new driver-fronted
 * flow: the driver pays the consumer via their own UPI, uploads a
 * screenshot proof, and admin later reimburses them. */
const VALID_FINALIZE_DESTINATIONS = ['manual_bank', 'store_credit', 'manual_upi'];
const DISPUTE_WINDOW_HOURS = 48;

function finalizeRefund({
  holdingId,
  resolvedByUserId,
  resolvedByRole,    // 'trader' | 'admin'
  outcome,           // 'refunded' | 'forfeited'
  notes,
  refundProofUrl,    // Phase 9 — required when outcome=refunded + destination=manual_upi
  damagePhotoUrl,    // Phase 9 — optional but strongly encouraged for forfeited
  overrideDestination, // Phase 9 — driver may pick manual_upi at pickup time
}) {
  if (!['refunded', 'forfeited'].includes(outcome)) {
    const err = new Error(`invalid outcome: ${outcome}`);
    err.code = 'INVALID_OUTCOME';
    throw err;
  }
  if (overrideDestination && !VALID_FINALIZE_DESTINATIONS.includes(overrideDestination)) {
    const err = new Error(`invalid destination: ${overrideDestination}`);
    err.code = 'INVALID_DESTINATION';
    throw err;
  }
  const row = db.prepare(`
    SELECT h.id, h.consumer_id, h.status, h.deposit_amount,
           h.refund_destination, h.invoice_id,
           c.linked_dealer_id
      FROM container_holdings h
      JOIN consumers c ON c.id = h.consumer_id
     WHERE h.id = ?
  `).get(holdingId);
  if (!row) {
    const err = new Error('holding not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (row.status !== 'refund_requested') {
    const err = new Error(`cannot finalize from status=${row.status}`);
    err.code = 'INVALID_STATUS';
    throw err;
  }
  /* Pickup is the linked dealer's responsibility regardless of distance.
   * Admins can override. Any other trader is rejected. */
  if (resolvedByRole !== 'admin' && resolvedByUserId !== row.linked_dealer_id) {
    const err = new Error('only the linked dealer or an admin can finalize this pickup');
    err.code = 'FORBIDDEN';
    throw err;
  }

  /* If the driver supplied a destination at pickup time, that wins over
   * whatever the consumer chose at refund-request time — the consumer
   * may have asked for bank transfer but the driver paid UPI on the spot. */
  const effectiveDestination = overrideDestination || row.refund_destination;
  if (outcome === 'refunded' && effectiveDestination === 'manual_upi' && !refundProofUrl) {
    const err = new Error('UPI refunds require a proof screenshot');
    err.code = 'PROOF_REQUIRED';
    throw err;
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE container_holdings
         SET status=?,
             refund_destination=?,
             refund_paid_via=?,
             refund_proof_url=COALESCE(?, refund_proof_url),
             damage_photo_url=COALESCE(?, damage_photo_url),
             driver_user_id=COALESCE(?, driver_user_id),
             resolved_at=CURRENT_TIMESTAMP,
             resolved_by=?,
             updated_at=CURRENT_TIMESTAMP,
             notes=COALESCE(?, notes),
             dispute_deadline=CASE WHEN ?='forfeited'
                                   THEN datetime(CURRENT_TIMESTAMP, '+${DISPUTE_WINDOW_HOURS} hours')
                                   ELSE dispute_deadline END,
             damage_dispute_status=CASE WHEN ?='forfeited' THEN 'open'
                                        ELSE damage_dispute_status END
       WHERE id=?
    `).run(
      outcome,
      effectiveDestination,
      outcome === 'refunded' ? effectiveDestination : null,
      refundProofUrl || null,
      damagePhotoUrl || null,
      resolvedByUserId, // driver_user_id — the agent doing the pickup
      resolvedByUserId,
      notes || null,
      outcome, outcome,
      holdingId,
    );

    /* Store-credit refunds are settled atomically with the status flip so
     * a partial failure can't leave a "refunded" holding with no credit
     * entry. Manual bank refunds are recorded by the admin via a
     * separate flow. UPI refunds wait for admin verification before any
     * money movement (the driver paid out-of-pocket; admin reimburses). */
    if (outcome === 'refunded' && effectiveDestination === 'store_credit') {
      db.prepare(`
        INSERT INTO consumer_store_credit_ledger
          (consumer_id, delta, reason, source_type, source_id, created_by)
        VALUES (?, ?, ?, 'container_refund', ?, ?)
      `).run(
        row.consumer_id,
        row.deposit_amount,
        `Container deposit refund (holding #${holdingId})`,
        holdingId,
        resolvedByUserId,
      );
    }

    /* Phase 9 finance log — one row per real-world money movement or
     * lifecycle event. Read by /admin/finance. */
    const eventType =
      outcome === 'forfeited' ? 'container_forfeited' :
      effectiveDestination === 'manual_upi' ? 'driver_upi_paid_consumer' :
      effectiveDestination === 'manual_bank' ? 'bank_refund_pending' :
      'store_credit_issued';
    db.prepare(`
      INSERT INTO container_finance_log
        (holding_id, consumer_id, driver_user_id, event_type, amount, direction, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      holdingId, row.consumer_id, resolvedByUserId,
      eventType,
      outcome === 'forfeited' ? 0 : row.deposit_amount,
      eventType === 'driver_upi_paid_consumer' ? 'driver_to_consumer' :
        eventType === 'store_credit_issued' ? 'company_to_consumer' :
        eventType === 'bank_refund_pending' ? 'pending' : 'none',
      resolvedByUserId,
    );
  });
  tx();
  return { ok: true, outcome, destination: effectiveDestination };
}

/* Phase 9 — admin verifies the UPI proof screenshot. Marks the refund
 * as confirmed by the company; the driver is still owed reimbursement
 * until adminReimburseDriver runs. */
function adminVerifyRefundProof({ holdingId, adminUserId, approved, notes }) {
  const row = db.prepare(`
    SELECT id, consumer_id, deposit_amount, refund_paid_via, refund_proof_url,
           admin_verified_at, driver_user_id
      FROM container_holdings WHERE id=?
  `).get(holdingId);
  if (!row) { const e = new Error('holding not found'); e.code='NOT_FOUND'; throw e; }
  if (row.refund_paid_via !== 'manual_upi') {
    const e = new Error('only manual_upi refunds can be verified here'); e.code='WRONG_FLOW'; throw e;
  }
  if (!row.refund_proof_url) {
    const e = new Error('no proof uploaded yet'); e.code='NO_PROOF'; throw e;
  }
  if (row.admin_verified_at && approved) {
    return { ok: true, noop: true };
  }
  const tx = db.transaction(() => {
    if (approved) {
      db.prepare(`
        UPDATE container_holdings
           SET admin_verified_at=CURRENT_TIMESTAMP,
               admin_verified_by=?,
               notes=COALESCE(? || char(10) || COALESCE(notes,''), notes),
               updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).run(adminUserId, notes || null, holdingId);
      db.prepare(`
        INSERT INTO container_finance_log
          (holding_id, consumer_id, driver_user_id, event_type, amount, direction, actor_user_id, reference)
        VALUES (?, ?, ?, 'admin_verified_upi_proof', ?, 'verification', ?, ?)
      `).run(holdingId, row.consumer_id, row.driver_user_id, row.deposit_amount, adminUserId, row.refund_proof_url);
    } else {
      // Rejection clears verification + reopens the proof requirement
      db.prepare(`
        UPDATE container_holdings
           SET admin_verified_at=NULL,
               admin_verified_by=NULL,
               refund_proof_url=NULL,
               notes=COALESCE(? || char(10) || COALESCE(notes,''), notes),
               updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).run(`Proof rejected: ${notes || 'no reason given'}`, holdingId);
      db.prepare(`
        INSERT INTO container_finance_log
          (holding_id, consumer_id, driver_user_id, event_type, amount, direction, actor_user_id)
        VALUES (?, ?, ?, 'admin_rejected_upi_proof', 0, 'verification', ?)
      `).run(holdingId, row.consumer_id, row.driver_user_id, adminUserId);
    }
  });
  tx();
  return { ok: true, approved: !!approved };
}

/* Phase 9 — admin marks the driver as reimbursed for the cash they
 * fronted. This is the final money-out event for a manual_upi refund. */
function adminReimburseDriver({ holdingId, adminUserId, amount, notes }) {
  const row = db.prepare(`
    SELECT id, consumer_id, deposit_amount, refund_paid_via,
           admin_verified_at, driver_user_id, driver_reimbursed_at
      FROM container_holdings WHERE id=?
  `).get(holdingId);
  if (!row) { const e = new Error('holding not found'); e.code='NOT_FOUND'; throw e; }
  if (row.refund_paid_via !== 'manual_upi') {
    const e = new Error('driver reimbursement only applies to UPI refunds'); e.code='WRONG_FLOW'; throw e;
  }
  if (!row.admin_verified_at) {
    const e = new Error('verify the proof before reimbursing the driver'); e.code='NOT_VERIFIED'; throw e;
  }
  if (row.driver_reimbursed_at) {
    return { ok: true, noop: true };
  }
  const reimbursed = amount != null ? Number(amount) : Number(row.deposit_amount);
  if (!Number.isFinite(reimbursed) || reimbursed <= 0) {
    const e = new Error('invalid amount'); e.code='INVALID_AMOUNT'; throw e;
  }
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE container_holdings
         SET driver_reimbursed_at=CURRENT_TIMESTAMP,
             driver_reimbursed_by=?,
             driver_reimbursed_amount=?,
             notes=COALESCE(? || char(10) || COALESCE(notes,''), notes),
             updated_at=CURRENT_TIMESTAMP
       WHERE id=?
    `).run(adminUserId, reimbursed, notes || null, holdingId);
    db.prepare(`
      INSERT INTO container_finance_log
        (holding_id, consumer_id, driver_user_id, event_type, amount, direction, actor_user_id)
      VALUES (?, ?, ?, 'driver_reimbursed', ?, 'company_to_driver', ?)
    `).run(holdingId, row.consumer_id, row.driver_user_id, reimbursed, adminUserId);
  });
  tx();
  return { ok: true, amount: reimbursed };
}

/* Phase 9 — consumer opens a damage dispute. Allowed only when the
 * holding is forfeited AND we are still within dispute_deadline. */
function openDamageDispute({ holdingId, consumerId, notes }) {
  const row = db.prepare(`
    SELECT id, consumer_id, status, dispute_deadline, damage_dispute_status
      FROM container_holdings WHERE id=?
  `).get(holdingId);
  if (!row) { const e = new Error('holding not found'); e.code='NOT_FOUND'; throw e; }
  if (row.consumer_id !== consumerId) {
    const e = new Error('not your holding'); e.code='FORBIDDEN'; throw e;
  }
  if (row.status !== 'forfeited') {
    const e = new Error('only forfeited holdings can be disputed'); e.code='INVALID_STATUS'; throw e;
  }
  if (!row.dispute_deadline || new Date(row.dispute_deadline + 'Z').getTime() < Date.now()) {
    const e = new Error('dispute window has closed'); e.code='WINDOW_CLOSED'; throw e;
  }
  if (row.damage_dispute_status && row.damage_dispute_status !== 'open') {
    const e = new Error(`dispute already ${row.damage_dispute_status}`); e.code='ALREADY_RESOLVED'; throw e;
  }
  db.prepare(`
    UPDATE container_holdings
       SET damage_dispute_status='open',
           dispute_opened_at=COALESCE(dispute_opened_at, CURRENT_TIMESTAMP),
           notes=COALESCE(? || char(10) || COALESCE(notes,''), notes),
           updated_at=CURRENT_TIMESTAMP
     WHERE id=?
  `).run(notes ? `Consumer dispute: ${notes}` : null, holdingId);
  db.prepare(`
    INSERT INTO container_finance_log
      (holding_id, consumer_id, event_type, amount, direction, actor_user_id)
    VALUES (?, ?, 'consumer_opened_dispute', 0, 'dispute', ?)
  `).run(holdingId, consumerId, consumerId);
  return { ok: true };
}

function getDamageDisputes() {
  return db.prepare(`
    SELECT h.id, h.consumer_id, h.deposit_amount, h.damage_photo_url,
           h.damage_dispute_status, h.dispute_deadline, h.dispute_opened_at,
           h.dispute_resolved_at, h.resolved_at, h.notes,
           c.name AS consumer_name, c.phone AS consumer_phone, c.email AS consumer_email
      FROM container_holdings h
      JOIN consumers c ON c.id=h.consumer_id
     WHERE h.status='forfeited'
       AND h.damage_dispute_status IS NOT NULL
     ORDER BY h.dispute_opened_at DESC, h.id DESC
  `).all();
}

/* List of refund_requested holdings the dealer is responsible for, with
 * consumer + product context so the agent can plan the pickup route.
 * Admins see all open pickups; traders see only their own consumers. */
function getPendingPickups({ userId, role }) {
  const where = role === 'admin'
    ? `h.status='refund_requested'`
    : `h.status='refund_requested' AND c.linked_dealer_id=?`;
  const args  = role === 'admin' ? [] : [userId];
  return db.prepare(`
    SELECT h.id, h.invoice_id, h.container_type, h.deposit_amount,
           h.refund_destination, h.requested_at, h.notes,
           h.created_at, h.updated_at,
           c.id   AS consumer_id,
           c.name AS consumer_name,
           c.phone AS consumer_phone,
           p_cur.name  AS current_product_name,
           p_orig.name AS original_product_name,
           (SELECT a.address || ', ' || a.pincode FROM consumer_addresses a
             WHERE a.consumer_id=c.id AND a.is_default=1 LIMIT 1) AS consumer_address
      FROM container_holdings h
      JOIN consumers c ON c.id = h.consumer_id
      JOIN products p_cur  ON p_cur.id  = h.current_product_id
      JOIN products p_orig ON p_orig.id = h.original_product_id
     WHERE ${where}
     ORDER BY h.requested_at ASC, h.id ASC
  `).all(...args);
}

/* Append-only store-credit balance read. */
function getStoreCreditBalance(consumerId) {
  const r = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) AS balance
      FROM consumer_store_credit_ledger
     WHERE consumer_id=?
  `).get(consumerId);
  return r ? Number(r.balance) : 0;
}

/* ── Phase 8: admin oversight ──────────────────────────────────────────
 * Holdings dashboard list + manual status override with audit trail.
 *
 * Override semantics:
 *   - Admin can force any holding to any of the 5 statuses.
 *   - If moving INTO refunded with destination=store_credit, a positive
 *     ledger row is written.
 *   - If moving AWAY from refunded+store_credit, a negative ledger row
 *     claws back the credit (source_type='admin_adjustment') so the
 *     balance stays consistent.
 *   - Every override writes one row in container_holdings_audit with the
 *     before/after status + destination snapshot.
 */
const VALID_STATUSES = ['pending_delivery', 'held', 'refund_requested', 'refunded', 'forfeited'];
const VALID_DESTINATIONS = ['manual_bank', 'store_credit'];

function listAllHoldings({ status, consumerId, search, containerType, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const args = [];
  if (status) {
    if (Array.isArray(status)) {
      clauses.push(`h.status IN (${status.map(() => '?').join(',')})`);
      args.push(...status);
    } else {
      clauses.push('h.status = ?');
      args.push(status);
    }
  }
  if (consumerId) { clauses.push('h.consumer_id = ?'); args.push(consumerId); }
  if (containerType) { clauses.push('h.container_type = ?'); args.push(containerType); }
  if (search && search.trim()) {
    clauses.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
    const like = `%${search.trim()}%`;
    args.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT h.id, h.consumer_id, h.invoice_id, h.container_type,
           h.deposit_amount, h.status, h.refund_destination,
           h.requested_at, h.resolved_at, h.manual_refund_utr,
           h.created_at, h.updated_at, h.notes,
           c.name  AS consumer_name,
           c.email AS consumer_email,
           c.phone AS consumer_phone,
           p_cur.name  AS current_product_name,
           p_orig.name AS original_product_name,
           u_dealer.name AS linked_dealer_name
      FROM container_holdings h
      JOIN consumers c        ON c.id = h.consumer_id
      JOIN products  p_cur    ON p_cur.id  = h.current_product_id
      JOIN products  p_orig   ON p_orig.id = h.original_product_id
      LEFT JOIN users u_dealer ON u_dealer.id = c.linked_dealer_id
      ${where}
     ORDER BY h.updated_at DESC, h.id DESC
     LIMIT ? OFFSET ?
  `).all(...args, limit, offset);

  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM container_holdings GROUP BY status
  `).all().reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});

  return { holdings: rows, statusCounts: counts };
}

function getHoldingDetail(holdingId) {
  const holding = db.prepare(`
    SELECT h.*, c.name AS consumer_name, c.email AS consumer_email, c.phone AS consumer_phone,
           p_cur.name  AS current_product_name,
           p_orig.name AS original_product_name,
           u_dealer.name AS linked_dealer_name,
           i.invoice_number
      FROM container_holdings h
      JOIN consumers c     ON c.id = h.consumer_id
      JOIN products p_cur  ON p_cur.id  = h.current_product_id
      JOIN products p_orig ON p_orig.id = h.original_product_id
      LEFT JOIN users u_dealer ON u_dealer.id = c.linked_dealer_id
      LEFT JOIN invoices i ON i.id = h.invoice_id
     WHERE h.id = ?
  `).get(holdingId);
  if (!holding) return null;
  const audit = db.prepare(`
    SELECT a.*, u.name AS actor_name
      FROM container_holdings_audit a
      JOIN users u ON u.id = a.actor_user_id
     WHERE a.holding_id = ?
     ORDER BY a.id DESC
  `).all(holdingId);
  return { holding, audit };
}

function adminOverrideHolding({ holdingId, actorUserId, newStatus, newDestination, notes }) {
  if (!VALID_STATUSES.includes(newStatus)) {
    const err = new Error(`invalid status: ${newStatus}`);
    err.code = 'INVALID_STATUS';
    throw err;
  }
  if (newDestination && !VALID_DESTINATIONS.includes(newDestination)) {
    const err = new Error(`invalid destination: ${newDestination}`);
    err.code = 'INVALID_DESTINATION';
    throw err;
  }
  if (newStatus === 'refunded' && !newDestination) {
    const err = new Error('refunded status requires a refund_destination');
    err.code = 'MISSING_DESTINATION';
    throw err;
  }

  const row = db.prepare(`
    SELECT id, consumer_id, status, refund_destination, deposit_amount
      FROM container_holdings WHERE id = ?
  `).get(holdingId);
  if (!row) {
    const err = new Error('holding not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const beforeStatus = row.status;
  const beforeDestination = row.refund_destination;
  const wasRefundedToStoreCredit = beforeStatus === 'refunded' && beforeDestination === 'store_credit';
  const willBeRefundedToStoreCredit = newStatus === 'refunded' && newDestination === 'store_credit';

  if (beforeStatus === newStatus && beforeDestination === (newDestination || null) && !notes) {
    return { ok: true, noop: true };
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE container_holdings
         SET status=?,
             refund_destination=?,
             resolved_at = CASE WHEN ? IN ('refunded','forfeited') THEN CURRENT_TIMESTAMP ELSE resolved_at END,
             resolved_by = CASE WHEN ? IN ('refunded','forfeited') THEN ?               ELSE resolved_by END,
             notes = COALESCE(? || char(10) || COALESCE(notes,''), notes),
             updated_at=CURRENT_TIMESTAMP
       WHERE id=?
    `).run(
      newStatus,
      newDestination || null,
      newStatus, newStatus, actorUserId,
      notes || null,
      holdingId,
    );

    // Ledger reconciliation
    if (willBeRefundedToStoreCredit && !wasRefundedToStoreCredit) {
      db.prepare(`
        INSERT INTO consumer_store_credit_ledger
          (consumer_id, delta, reason, source_type, source_id, created_by)
        VALUES (?, ?, ?, 'container_refund', ?, ?)
      `).run(
        row.consumer_id,
        row.deposit_amount,
        `Container deposit refund (admin override, holding #${holdingId})`,
        holdingId,
        actorUserId,
      );
    } else if (wasRefundedToStoreCredit && !willBeRefundedToStoreCredit) {
      db.prepare(`
        INSERT INTO consumer_store_credit_ledger
          (consumer_id, delta, reason, source_type, source_id, created_by)
        VALUES (?, ?, ?, 'admin_adjustment', ?, ?)
      `).run(
        row.consumer_id,
        -Math.abs(row.deposit_amount),
        `Reversal — admin override on holding #${holdingId}`,
        holdingId,
        actorUserId,
      );
    }

    db.prepare(`
      INSERT INTO container_holdings_audit
        (holding_id, actor_user_id, action,
         before_status, after_status,
         before_destination, after_destination, notes)
      VALUES (?, ?, 'override', ?, ?, ?, ?, ?)
    `).run(
      holdingId, actorUserId,
      beforeStatus, newStatus,
      beforeDestination, newDestination || null,
      notes || null,
    );
  });
  tx();

  return { ok: true, beforeStatus, afterStatus: newStatus };
}

module.exports = {
  createHoldingsForInvoice,
  markHoldingsDelivered,
  getHeldContainers,
  getRefillCap,
  getAllHoldingsForConsumer,
  requestRefund,
  cancelRefund,
  requestSwap,
  finalizeRefund,
  adminVerifyRefundProof,
  adminReimburseDriver,
  openDamageDispute,
  getDamageDisputes,
  getPendingPickups,
  getStoreCreditBalance,
  listAllHoldings,
  getHoldingDetail,
  adminOverrideHolding,
  VALID_STATUSES,
  VALID_DESTINATIONS,
};
