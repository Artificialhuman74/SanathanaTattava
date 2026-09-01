/**
 * The 13th-month guarantee (spec §3.14).
 *
 * Anyone still enrolled when a round finishes, who never won, gets one free
 * delivery of their most recent qualifying purchase. It is the promise made to
 * everyone who does NOT win, which is most of the people in any round, so it
 * runs automatically when the round ends rather than waiting to be asked for.
 *
 * Settled policy (confirmed with the founder, resolving §14):
 *   - Being enrolled at month 12 is enough. No unbroken streak is required,
 *     because a missed month only ever cost that month's entry (§3.9).
 *   - Someone who never made any qualifying purchase at all has nothing to
 *     deliver. They are closed out, not given an arbitrary product.
 *
 * Isolated under services/luckyDraw/ like the rest of the feature (§10).
 */
const db = require('../../database/db');
const { createNotification } = require('../notificationService');
const { LUCKY_DRAW_NAME } = require('../../config/luckyDraw');
const { generateInvoiceForOrder } = require('../invoiceService');

/** Marks the free order apart from a purchase (BC…), the welcome gift
 *  (BCGIFT) and a winner's monthly reward (BCFREE). */
const ORDER_PREFIX = 'BCGUAR-';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Their most recent qualifying purchase in this round: what gets delivered. */
function lastQualifyingPurchase(enrollmentId) {
  return db.prepare(`
    SELECT oi.product_id, oi.quantity, p.name AS product_name, p.container_type
      FROM lucky_draw_monthly_entries me
      JOIN consumer_orders o ON o.id = me.qualifying_order_id
      JOIN consumer_order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
     WHERE me.enrollment_id = ? AND me.qualified = 1 AND me.qualifying_order_id IS NOT NULL
     ORDER BY me.month_number DESC, oi.total DESC
     LIMIT 1
  `).get(enrollmentId);
}

/** The address the free delivery goes to, same resolution the rest uses. */
function deliveryAddress(consumerId, consumer) {
  return db.prepare(`
    SELECT name, phone, address, pincode, latitude, longitude, h3_index
      FROM consumer_addresses WHERE consumer_id = ?
     ORDER BY is_default DESC, created_at ASC LIMIT 1
  `).get(consumerId)
    || (consumer.address && consumer.pincode
      ? { ...consumer, latitude: null, longitude: null, h3_index: null }
      : null);
}

/**
 * Place one guarantee delivery. Mirrors the winner's ₹0 reward order: same
 * routing to the consumer's dealer, same admin fallback, same dealer
 * notification, and an invoice so any container it arrives in is recorded.
 */
function placeGuaranteeOrder({ enrollment, consumer, purchase, now }) {
  const addr = deliveryAddress(consumer.id, consumer);
  if (!addr) return { skipped: 'no_address' };

  const linkedDealerId = consumer.linked_dealer_id ?? null;
  const isDirect = linkedDealerId === null ? 1 : 0;
  let deliveryDealerId = linkedDealerId;
  let assignmentStatus = linkedDealerId ? 'assigned' : 'unassigned';
  if (!deliveryDealerId) {
    const admin = db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1`).get();
    if (admin) { deliveryDealerId = admin.id; assignmentStatus = 'admin'; }
  }

  const qty = purchase.quantity || 1;

  // If they already hold this container, the guarantee is a refill too: no
  // reason to hand over a second one for a round that has just finished.
  const isRefill = purchase.container_type
    ? db.prepare(`
        SELECT COUNT(*) AS n FROM container_holdings
         WHERE consumer_id = ? AND current_product_id = ?
           AND status IN ('held', 'pending_delivery')
      `).get(consumer.id, purchase.product_id).n > 0 ? 1 : 0
    : 0;

  const orderNumber = `${ORDER_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ');

  const result = db.transaction(() => {
    const or = db.prepare(`
      INSERT INTO consumer_orders
        (order_number, consumer_id, linked_dealer_id, delivery_dealer_id, is_direct, status, payment_status,
         subtotal, total_amount, pincode, delivery_address, notes, confirmation_sent,
         delivery_latitude, delivery_longitude, delivery_h3_index, assignment_status, created_at)
      VALUES (?,?,?,?,?, 'pending', 'paid', 0, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      orderNumber, consumer.id, linkedDealerId, deliveryDealerId, isDirect,
      addr.pincode, addr.address,
      `${LUCKY_DRAW_NAME} 13th-month guarantee`,
      addr.latitude || null, addr.longitude || null, addr.h3_index || null, assignmentStatus, stamp,
    );
    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, container_cost, is_refill)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).run(or.lastInsertRowid, purchase.product_id, qty, isRefill);
    db.prepare(`UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?`).run(qty, purchase.product_id);
    return { orderId: or.lastInsertRowid, orderNumber };
  })();

  if (deliveryDealerId) {
    try {
      createNotification(
        'dealer', deliveryDealerId,
        `${LUCKY_DRAW_NAME} guarantee to pack — ${consumer.name}`,
        `${consumer.name} finished ${LUCKY_DRAW_NAME} without winning, so their last purchase (${purchase.product_name} x${qty}) goes out free. ${isRefill ? 'REFILL: they already have the container, so top it up.' : 'Goes out in a new container.'} No charge.`,
        { order_id: result.orderId, order_number: result.orderNumber },
      );
    } catch { /* non-fatal */ }
  }

  // Every free order gets its ₹0 receipt, container or not: goods are leaving
  // and arriving somewhere, which needs a document either way. It also
  // materialises the container holding when there is one.
  generateInvoiceForOrder(result.orderId)
    .catch(err => console.error(`[lucky-draw] guarantee invoice for ${result.orderNumber} failed:`, err.message));

  return { order_number: result.orderNumber, product_name: purchase.product_name, quantity: qty };
}

/**
 * Close out a finished round: everyone still trying gets their guarantee.
 *
 * Idempotent. An enrollment moves to 'completed' as it is handled, so a second
 * run finds nobody left — which matters because this is called from a
 * scheduler tick that may fire again before the scheme's status has settled.
 */
function runGuaranteeForScheme(schemeId, now = new Date()) {
  const scheme = db.prepare(`SELECT * FROM lucky_draw_schemes WHERE id = ?`).get(schemeId);
  if (!scheme) throw httpError(404, 'Scheme not found');

  /* 'active' means enrolled and never won: winners are already on 'won' and
   * have had their reward all round. That is the whole population §3.14
   * describes, and it needs no streak check — being here is the condition. */
  const owed = db.prepare(`
    SELECT e.*, c.name AS consumer_name FROM lucky_draw_enrollments e
    JOIN consumers c ON c.id = e.consumer_id
    WHERE e.scheme_id = ? AND e.status = 'active'
  `).all(schemeId);

  const delivered = [];
  const skipped = [];

  for (const enrollment of owed) {
    const consumer = db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(enrollment.consumer_id);
    const purchase = lastQualifyingPurchase(enrollment.id);

    if (!purchase) {
      // Enrolled, paid the joining fee, never bought anything that qualified.
      // There is no "most recent qualifying purchase" to give them, and
      // inventing one would be worse than closing the round honestly.
      db.prepare(`UPDATE lucky_draw_enrollments SET status='completed' WHERE id=?`).run(enrollment.id);
      skipped.push({ consumer_id: consumer.id, reason: 'no_qualifying_purchase' });
      try {
        createNotification(
          'consumer', consumer.id,
          `${scheme.name} has finished`,
          `The round is over. The 13th-month delivery goes to your most recent qualifying purchase, and there wasn't one on this round.`,
          { scheme_id: schemeId },
        );
      } catch { /* non-fatal */ }
      continue;
    }

    const placed = placeGuaranteeOrder({ enrollment, consumer, purchase, now });
    if (placed.skipped) {
      skipped.push({ consumer_id: consumer.id, reason: placed.skipped });
      continue;   // left 'active' so it can be retried once they add an address
    }

    db.prepare(`UPDATE lucky_draw_enrollments SET status='completed' WHERE id=?`).run(enrollment.id);
    delivered.push({ consumer_id: consumer.id, ...placed });

    try {
      createNotification(
        'consumer', consumer.id,
        `Your ${scheme.name} delivery is on its way`,
        `The round is over. You didn't win a monthly draw, so your last purchase, ${placed.product_name}, is coming to you free.`,
        { scheme_id: schemeId, order_number: placed.order_number },
      );
    } catch { /* non-fatal */ }
  }

  return { scheme_id: schemeId, scheme_name: scheme.name, delivered, skipped };
}

module.exports = { runGuaranteeForScheme, ORDER_PREFIX };
