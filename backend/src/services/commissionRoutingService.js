/**
 * Commission routing for admin-delivered orders.
 *
 * Business rule: when an order's delivery is handled by an admin — a
 * direct order routed to admin, an admin takeover, or admin marking the
 * order delivered from the admin panel — the commission belongs to the
 * founder account, not the linked dealer. The dealer didn't do the
 * delivery work.
 *
 * "Admin is delivering" can become true at several different moments
 * (order creation, payment, takeover, delivered), and payouts can be
 * processed at any time in between. So this sync is called at EVERY
 * transition point; it corrects the pending commission's owner the
 * instant the state changes, which means the payouts page can never
 * observe a stale owner.
 *
 * Deliberately one-way: it never reassigns a commission BACK to a
 * dealer. Reversals are rare, and one-way keeps this from fighting any
 * manual commission adjustments done by the admin.
 *
 * Only rows with status='pending' are ever touched. Paid-out history
 * ('transferred', 'confirmed', …) is immutable here by construction.
 *
 * Keyed strictly on email — there are multiple users named "Chiranth";
 * only the founder account (referral A0000) should catch this routing.
 */
const db = require('../database/db');

const FOUNDER_EMAIL = 'barathichiru@gmail.com';

function getFounder() {
  return db.prepare(
    `SELECT id, commission_rate FROM users WHERE email = ?`
  ).get(FOUNDER_EMAIL);
}

/** True when the order's delivery is in admin hands, via any signal:
 *  admin takeover, admin marking delivered directly, or the assigned
 *  delivery user having the admin role (direct orders). */
function isAdminDelivering(order) {
  if (!order) return false;
  if (order.admin_taken_over_at || order.admin_overridden_at) return true;
  if (!order.delivery_dealer_id) return false;
  const u = db.prepare(`SELECT role FROM users WHERE id = ?`).get(order.delivery_dealer_id);
  return !!u && u.role === 'admin';
}

function currentWeekBounds() {
  const now = new Date();
  const ws  = new Date(now); ws.setDate(now.getDate() - now.getDay() + 1);
  const we  = new Date(ws);  we.setDate(ws.getDate() + 6);
  return { weekStart: ws.toISOString().slice(0, 10), weekEnd: we.toISOString().slice(0, 10) };
}

/**
 * Re-route this order's pending commissions to the founder if (and only
 * if) admin is delivering it. Safe to call from anywhere, any number of
 * times; no-ops when the rule doesn't apply. Never throws — commission
 * bookkeeping must not block order/delivery flows (callers still wrap
 * in try/catch out of caution).
 */
function syncAdminDeliveryCommission(orderId) {
  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id = ?`).get(orderId);
  if (!order || !isAdminDelivering(order)) return;

  const founder = getFounder();
  if (!founder) {
    console.error(`[commission] admin-delivery sync: founder account ${FOUNDER_EMAIL} not found; skipping`);
    return;
  }

  const moved = db.prepare(`
    UPDATE commissions
       SET trader_id = ?
     WHERE consumer_order_id = ?
       AND status = 'pending'
       AND trader_id != ?
  `).run(founder.id, order.id, founder.id);

  if (moved.changes > 0) {
    console.log(
      `[commission] admin-delivery: rerouted ${moved.changes} pending commission(s) on order ${order.id} to founder`
    );
  }

  /* Direct/guest orders never get a commission row at payment time
   * (no linked dealer). When admin delivers one, record the founder's
   * commission — but only once the money is real (paid or delivered). */
  const existing = db.prepare(
    `SELECT COUNT(*) AS n FROM commissions WHERE consumer_order_id = ?`
  ).get(order.id);

  const moneyIsReal = order.payment_status === 'paid' || order.status === 'delivered';
  if (existing.n === 0 && moneyIsReal) {
    const { weekStart, weekEnd } = currentWeekBounds();
    const commAmt = parseFloat(
      (order.total_amount * founder.commission_rate / 100).toFixed(2)
    );
    db.prepare(`
      INSERT INTO commissions
        (trader_id, consumer_order_id, amount, rate, type, status, week_start, week_end)
      VALUES (?, ?, ?, ?, 'direct', 'pending', ?, ?)
    `).run(founder.id, order.id, commAmt, founder.commission_rate, weekStart, weekEnd);

    console.log(
      `[commission] admin-delivery: created direct commission for order ${order.id} (₹${commAmt} to founder)`
    );
  }
}

module.exports = { syncAdminDeliveryCommission, isAdminDelivering };
