/**
 * Dev/testing-only tools for the consumer app: manually trigger states that
 * are normally reached through real purchases, real deliveries, or
 * scheduled jobs that don't exist yet (the lucky-draw monthly draw).
 *
 * Gated on DEV_TOOLS_ENABLED — set on local dev and the Railway "testing"
 * environment ONLY. Never set this on production; every route in this file
 * also independently checks the flag so mounting it accidentally is not
 * enough to expose it.
 *
 * Isolated on purpose, same reasoning as routes/luckyDraw.js: this is
 * throwaway scaffolding, not product code — deleting this one file removes
 * the whole surface.
 *
 * Every route operates ONLY on the calling consumer's own data — dev tools
 * still shouldn't let one test account touch another's rows, even in a
 * testing environment.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { createNotification } = require('../services/notificationService');
const { createHoldingsForInvoice, markHoldingsDelivered, requestRefund, openDamageDispute } = require('../services/containerHoldingsService');
const { LUCKY_DRAW_NAME } = require('../config/luckyDraw');
const drawService = require('../services/luckyDraw/drawService');

const router = express.Router();

const DEV_TOOLS_ENABLED = process.env.DEV_TOOLS_ENABLED === 'true';

const requireDevTools = (req, res, next) => {
  if (!DEV_TOOLS_ENABLED) return res.status(404).json({ error: 'Not found' });
  next();
};
router.use(requireDevTools);

const authConsumer = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'consumer') return res.status(403).json({ error: 'Consumer access only' });
    const c = db.prepare('SELECT * FROM consumers WHERE id=? AND status=?').get(decoded.id, 'active');
    if (!c) return res.status(401).json({ error: 'Consumer not found' });
    req.consumer = c;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const handleError = (err, res) => {
  console.error('[dev-tools]', err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
};
const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * The enrollment these tools act on, in whatever state it happens to be.
 *
 * Each lucky-draw tool used to run its own query with its own status filter,
 * which is how they drifted apart: "force win" wanted 'active' while "force
 * 13th month" accepted 'won', and every one of them failed with the same
 * unhelpful "No active enrollment". A dev tool that won't say what state you
 * are actually in is worse than no dev tool.
 */
function currentEnrollment(consumerId) {
  return db.prepare(`
    SELECT e.*, s.name AS scheme_name, s.status AS scheme_status
      FROM lucky_draw_enrollments e
      JOIN lucky_draw_schemes s ON s.id = e.scheme_id
     WHERE e.consumer_id = ?
     ORDER BY e.created_at DESC LIMIT 1
  `).get(consumerId);
}

/** Same lookup, but the failure tells you where you are and how to get out. */
function requireEnrollment(consumerId, allowed, action) {
  const e = currentEnrollment(consumerId);
  if (!e) {
    throw httpError(400, `You're not enrolled in any scheme, so there's nothing to ${action}. Join one from Bhagya Chakra first.`);
  }
  if (!allowed.includes(e.status)) {
    const wanted = allowed.map(a => `"${a}"`).join(' or ');
    throw httpError(400,
      `Your ${e.scheme_name} enrollment is "${e.status}", but ${action} needs it to be ${wanted}. ` +
      (e.status === 'pending_payment'
        ? 'Finish or abandon the join first, then use "Reset my enrollment".'
        : 'Use "Reset my enrollment" to start a fresh round.'));
  }
  return e;
}

/** Unauthenticated — tells the frontend whether to show the Test Console at all. */
router.get('/status', (_req, res) => res.json({ enabled: true }));

/* ═══════════════════════════════════════════════════════════════════════
 * Lucky draw
 * ═══════════════════════════════════════════════════════════════════════ */

/* Re-runnable on purpose. An already-'won' enrollment is still a valid
 * target, because the thing being tested is usually the win moment itself —
 * the reveal, the notification, the copy — and that needs replaying without
 * tearing the enrollment down and re-paying the joining fee first. Winning a
 * month you have already won is not a state the real draw job will ever
 * produce; it is a state this tool exists to reproduce. */
/**
 * Join a scheme without paying, or activate a join that stalled at payment.
 *
 * Every other lucky-draw tool here needs an 'active' or 'won' enrollment, and
 * on a deployed testing box the only other way to get one is a real Razorpay
 * payment. Without this, "you're not enrolled" was a dead end the error
 * message itself couldn't resolve.
 */
router.post('/lucky-draw/force-enroll', authConsumer, (req, res) => {
  try {
    const existing = currentEnrollment(req.consumer.id);

    if (existing && ['active', 'won'].includes(existing.status)) {
      throw httpError(400, `You're already in ${existing.scheme_name} ("${existing.status}"). Reset your enrollment first to join a different one.`);
    }

    // A join that stalled at the payment step just needs finishing.
    if (existing && existing.status === 'pending_payment') {
      db.prepare(`UPDATE lucky_draw_enrollments SET status='active', enrolled_at=CURRENT_TIMESTAMP WHERE id=?`).run(existing.id);
      return res.json({ success: true, enrollment_id: existing.id, scheme_name: existing.scheme_name, status: 'active', activated_pending: true });
    }

    // Prefer a scheme that's actually running, since that's the state the
    // monthly draw and the front-page takeover are reached from.
    const scheme = db.prepare(`
      SELECT id, name, status FROM lucky_draw_schemes
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'enrollment_open' THEN 1 ELSE 2 END, id DESC
       LIMIT 1
    `).get();
    if (!scheme) throw httpError(400, 'No schemes exist yet. Create one from the admin Bhagya Chakra page first.');

    const gift = db.prepare(`SELECT id FROM products WHERE unit='200ml' AND status='active' ORDER BY id LIMIT 1`).get();
    const result = db.prepare(`
      INSERT INTO lucky_draw_enrollments
        (scheme_id, consumer_id, status, joining_fee_paid, enrolled_at, welcome_gift_product_id)
      VALUES (?, ?, 'active', 0, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(consumer_id, scheme_id) DO UPDATE SET status='active', enrolled_at=CURRENT_TIMESTAMP
    `).run(scheme.id, req.consumer.id, gift ? gift.id : null);

    createNotification(
      'consumer', req.consumer.id,
      `You're in ${scheme.name}`,
      `[Dev tool] Enrolled without payment. Order this month to enter the draw.`,
      { scheme_id: scheme.id },
    );

    res.json({
      success: true,
      enrollment_id: result.lastInsertRowid,
      scheme_name: scheme.name,
      scheme_status: scheme.status,
      status: 'active',
    });
  } catch (err) { handleError(err, res); }
});

router.post('/lucky-draw/force-win', authConsumer, (req, res) => {
  try {
    const enrollment = requireEnrollment(req.consumer.id, ['active', 'won'], 'force a win');

    // Reward is "whatever they bought last" — reuse their welcome-gift
    // product as a stand-in when there's no other order history yet.
    const lastOrder = db.prepare(`
      SELECT oi.product_id, oi.quantity FROM consumer_order_items oi
      JOIN consumer_orders o ON o.id = oi.order_id
      WHERE o.consumer_id = ? ORDER BY o.created_at DESC LIMIT 1
    `).get(req.consumer.id);
    const rewardProductId = lastOrder?.product_id || enrollment.welcome_gift_product_id;
    const rewardQty = lastOrder?.quantity || 1;

    // Re-winning keeps the month it was first won on; only a first win sets it.
    const cycle = drawService.getConsumerCycle(req.consumer.id);
    const wonAtMonth = enrollment.won_at_month || cycle?.month_number || 1;

    db.prepare(`
      UPDATE lucky_draw_enrollments
         SET status='won', won_at_month=?, reward_product_id=?, reward_quantity=?
       WHERE id=?
    `).run(wonAtMonth, rewardProductId, rewardQty, enrollment.id);

    // A real draw also writes the ledger row, and everything downstream reads
    // the result from there rather than from the enrollment: the reveal, the
    // winner's name, the front-page card. Flipping the enrollment alone made
    // someone a winner that no draw had ever produced, so the app had a
    // winner with no result to show them.
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries
        (enrollment_id, month_number, qualified, is_winner, draw_run_at)
      VALUES (?, ?, 1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(enrollment_id, month_number) DO UPDATE SET
        qualified = 1, is_winner = 1, draw_run_at = CURRENT_TIMESTAMP
    `).run(enrollment.id, wonAtMonth);

    createNotification(
      'consumer', req.consumer.id,
      `You won ${enrollment.scheme_name}!`,
      `[Dev tool] Marked as a winner. Your reward item will be delivered free for the rest of the round.`,
      { scheme_id: enrollment.scheme_id },
    );
    res.json({
      success: true,
      enrollment_id: enrollment.id,
      status: 'won',
      won_at_month: wonAtMonth,
      replayed: enrollment.status === 'won',
    });
  } catch (err) { handleError(err, res); }
});

/* Runs the real draw decision logic (drawService.runDrawForScheme) against
 * this consumer's scheme, standing in for the scheduled 12th-of-the-month job
 * that isn't built yet. This is what makes the post-draw front page reachable:
 * without a completed draw there is nothing for it to announce. */
router.post('/lucky-draw/run-draw', authConsumer, (req, res) => {
  try {
    const enrollment = requireEnrollment(req.consumer.id, ['active', 'won'], 'run a draw');
    res.json(drawService.runDrawForScheme(enrollment.scheme_id));
  } catch (err) { handleError(err, res); }
});

/**
 * Undo this month's free reward order so the whole claim can be walked again.
 *
 * The winner's card is a once-a-month action, which makes it the hardest part
 * of the feature to look at twice: after one tap it is booked until the 1st.
 * This puts it back — the order, its invoice, and the container holding that
 * came with it all go, so what returns is the card as a winner first meets it,
 * not a half-cleared version of it.
 */
router.post('/lucky-draw/reset-monthly-claim', authConsumer, (req, res) => {
  try {
    const enrollment = requireEnrollment(req.consumer.id, ['won'], "replay this month's free order");
    const cycle = drawService.getConsumerCycle(req.consumer.id);
    if (!cycle) throw httpError(400, `${enrollment.scheme_name} is not running, so there is no month to claim.`);

    const order = db.prepare(`
      SELECT id, order_number FROM consumer_orders
       WHERE consumer_id = ? AND order_number LIKE 'BCFREE-%' AND status != 'cancelled'
       ORDER BY created_at DESC LIMIT 1
    `).get(req.consumer.id);
    if (!order) {
      throw httpError(400, "This month's free order hasn't been placed yet, so there is nothing to undo. Open Bhagya Chakra and claim it first.");
    }

    const removed = db.transaction(() => {
      /* The order is CANCELLED, not deleted. Half a dozen tables carry a
       * foreign key to consumer_orders, and unpicking them one at a time is
       * how a dev tool quietly corrupts a database. `rewardOrderThisMonth`
       * already ignores cancelled orders, so cancelling is all it takes to
       * reopen the claim, and it leaves an honest trail of what was undone. */
      db.prepare(`UPDATE consumer_orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(order.id);

      // Put back the stock that placing it took out.
      for (const it of db.prepare(`SELECT product_id, quantity FROM consumer_order_items WHERE order_id = ?`).all(order.id)) {
        db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`).run(it.quantity, it.product_id);
      }

      /* The container went with the reward, so it goes back too, otherwise it
       * sits in their list attached to an order that no longer stands. Its
       * three referencing tables are cleared first: a plain delete fails
       * against any of them. */
      const inv = db.prepare(`SELECT id FROM invoices WHERE order_id = ?`).get(order.id);
      let holdings = 0;
      if (inv) {
        for (const r of db.prepare(
          `SELECT id FROM container_holdings WHERE invoice_id = ? AND source = 'lucky_draw_reward'`
        ).all(inv.id)) {
          db.prepare(`DELETE FROM container_holdings_audit WHERE holding_id = ?`).run(r.id);
          db.prepare(`DELETE FROM container_swaps WHERE holding_id = ?`).run(r.id);
          db.prepare(`UPDATE container_finance_log SET holding_id = NULL WHERE holding_id = ?`).run(r.id);
          holdings += db.prepare(`DELETE FROM container_holdings WHERE id = ?`).run(r.id).changes;
        }
      }
      return { holdings, invoice: !!inv };
    })();

    res.json({
      success: true,
      order_number: order.order_number,
      containers_removed: removed.holdings,
      invoice_removed: removed.invoice,
      month_number: cycle.month_number,
    });
  } catch (err) { handleError(err, res); }
});

router.post('/lucky-draw/force-13th-month', authConsumer, (req, res) => {
  try {
    const enrollment = requireEnrollment(req.consumer.id, ['active', 'won'], 'complete the round');

    db.prepare(`UPDATE lucky_draw_enrollments SET status='completed' WHERE id=?`).run(enrollment.id);
    createNotification(
      'consumer', req.consumer.id,
      `${enrollment.scheme_name} ended`,
      `[Dev tool] Marked as completed via the 13th-month guarantee. You're free to join a new round.`,
      { scheme_id: enrollment.scheme_id },
    );
    res.json({ success: true, enrollment_id: enrollment.id, status: 'completed' });
  } catch (err) { handleError(err, res); }
});

router.post('/lucky-draw/simulate-missed-month', authConsumer, (req, res) => {
  try {
    const enrollment = requireEnrollment(req.consumer.id, ['active', 'won'], 'record a missed month');

    // The month this marks is the calendar month we are actually in, not
    // MAX(month_number)+1. That old counter invented a number unrelated to the
    // round's real month numbering, so it drifted further out of step with
    // every use and could collide with the row a real order had written.
    const cycle = drawService.getConsumerCycle(req.consumer.id);
    if (!cycle) throw httpError(400, `${enrollment.scheme_name} is not running, so it has no current month to miss.`);

    // Upsert, not insert: if an order already qualified them this month, the
    // point of this tool is to take that away.
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries (enrollment_id, month_number, qualifying_order_id, qualified, is_winner)
      VALUES (?, ?, NULL, 0, 0)
      ON CONFLICT(enrollment_id, month_number) DO UPDATE SET
        qualifying_order_id = NULL, qualified = 0, is_winner = 0
    `).run(enrollment.id, cycle.month_number);

    res.json({ success: true, month_recorded_as_missed: cycle.month_number });
  } catch (err) { handleError(err, res); }
});

router.post('/lucky-draw/reset', authConsumer, (req, res) => {
  try {
    const rows = db.prepare(`SELECT id FROM lucky_draw_enrollments WHERE consumer_id = ?`).all(req.consumer.id);
    for (const r of rows) {
      db.prepare(`DELETE FROM lucky_draw_monthly_entries WHERE enrollment_id=?`).run(r.id);
    }
    const result = db.prepare(`DELETE FROM lucky_draw_enrollments WHERE consumer_id = ?`).run(req.consumer.id);
    res.json({ success: true, cleared: result.changes });
  } catch (err) { handleError(err, res); }
});

/* ═══════════════════════════════════════════════════════════════════════
 * Order / delivery lifecycle
 * ═══════════════════════════════════════════════════════════════════════ */

function resolveAddress(consumerId) {
  const saved = db.prepare(`
    SELECT name, phone, address, pincode FROM consumer_addresses
    WHERE consumer_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1
  `).get(consumerId);
  if (saved) return saved;
  const c = db.prepare(`SELECT name, phone, address, pincode FROM consumers WHERE id=?`).get(consumerId);
  return c?.address && c?.pincode ? c : null;
}

/** Creates a small real order (1 unit of the first active product) already 'confirmed'/'paid', ready to advance through delivery. */
router.post('/orders/create-test-order', authConsumer, (req, res) => {
  try {
    const addr = resolveAddress(req.consumer.id);
    if (!addr) throw httpError(400, 'Add a delivery address to your account first');
    const product = db.prepare(`SELECT * FROM products WHERE status='active' ORDER BY id LIMIT 1`).get();
    if (!product) throw httpError(400, 'No active products to order');

    const orderNumber = `DEVTEST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const result = db.transaction(() => {
      const or = db.prepare(`
        INSERT INTO consumer_orders
          (order_number, consumer_id, is_direct, status, payment_status, subtotal, total_amount,
           pincode, delivery_address, delivery_status, notes, assignment_status)
        VALUES (?,?,1,'confirmed','paid',?,?,?,?, 'pending', '[Dev tool] test order', 'unassigned')
      `).run(orderNumber, req.consumer.id, product.price, product.price, addr.pincode, addr.address);
      db.prepare(`
        INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, container_cost, is_refill)
        VALUES (?, ?, 1, ?, ?, 0, 0)
      `).run(or.lastInsertRowid, product.id, product.price, product.price);
      return or.lastInsertRowid;
    })();

    // Created already-paid, so it registers as a qualifying purchase exactly
    // as a real payment would. Without this, "Run this month's draw" would
    // find an empty pool right after a test order was placed.
    drawService.recordQualifyingOrder(result);

    res.json({ success: true, order_id: result, order_number: orderNumber, product_name: product.name });
  } catch (err) { handleError(err, res); }
});

router.get('/orders/mine', authConsumer, (req, res) => {
  const orders = db.prepare(`
    SELECT id, order_number, status, delivery_status, total_amount, created_at
      FROM consumer_orders WHERE consumer_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(req.consumer.id);
  res.json({ orders });
});

const DELIVERY_STEPS = ['pending', 'accepted', 'packed', 'out_for_delivery', 'delivered'];

router.post('/orders/:id/advance-delivery', authConsumer, (req, res) => {
  try {
    const order = db.prepare(`SELECT * FROM consumer_orders WHERE id=? AND consumer_id=?`).get(req.params.id, req.consumer.id);
    if (!order) throw httpError(404, 'Order not found');
    const idx = DELIVERY_STEPS.indexOf(order.delivery_status || 'pending');
    if (idx === -1 || idx === DELIVERY_STEPS.length - 1) throw httpError(400, 'Already delivered — nothing further to advance');
    const next = DELIVERY_STEPS[idx + 1];
    const timestampCol = {
      accepted: 'delivery_accepted_at', packed: 'delivery_packed_at',
      out_for_delivery: 'delivery_started_at', delivered: 'delivery_verified_at',
    }[next];
    db.prepare(`UPDATE consumer_orders SET delivery_status=?, ${timestampCol}=CURRENT_TIMESTAMP WHERE id=?`).run(next, order.id);
    if (next === 'delivered') markHoldingsDelivered(order.id);
    createNotification('consumer', req.consumer.id, `Order ${order.order_number} — ${next.replace(/_/g, ' ')}`,
      `[Dev tool] Delivery status advanced to "${next.replace(/_/g, ' ')}".`, { order_id: order.id });
    res.json({ success: true, delivery_status: next });
  } catch (err) { handleError(err, res); }
});

/* ═══════════════════════════════════════════════════════════════════════
 * Container holdings
 * ═══════════════════════════════════════════════════════════════════════ */

router.post('/containers/force-held', authConsumer, (req, res) => {
  try {
    const addr = resolveAddress(req.consumer.id);
    if (!addr) throw httpError(400, 'Add a delivery address to your account first');
    const product = db.prepare(`SELECT * FROM products WHERE status='active' AND container_type IS NOT NULL ORDER BY id LIMIT 1`).get();
    if (!product) throw httpError(400, 'No container-type product configured to hold — ask admin to tag a product with a container type in Inventory');

    const deposit = product.container_cost || 150;
    const orderNumber = `DEVTEST-CTR-${Date.now()}`;
    const { orderId, invoiceId } = db.transaction(() => {
      const or = db.prepare(`
        INSERT INTO consumer_orders
          (order_number, consumer_id, is_direct, status, payment_status, subtotal, total_amount,
           pincode, delivery_address, delivery_status, container_costs_total, notes, assignment_status)
        VALUES (?,?,1,'confirmed','paid',?,?,?,?, 'delivered', ?, '[Dev tool] test holding', 'unassigned')
      `).run(orderNumber, req.consumer.id, product.price, product.price + deposit, addr.pincode, addr.address, deposit);
      const item = db.prepare(`
        INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, container_cost, is_refill)
        VALUES (?, ?, 1, ?, ?, ?, 0)
      `).run(or.lastInsertRowid, product.id, product.price, product.price, deposit);
      const inv = db.prepare(`
        INSERT INTO invoices (invoice_number, order_id, customer_name, items_json, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, container_deposit, total_amount, container_deposit_status, invoice_type)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'tax')
      `).run(`DEVINV-${Date.now()}`, or.lastInsertRowid, req.consumer.name, '[]', product.price, 0, 0, 0, deposit, product.price + deposit, 'held');
      return { orderId: or.lastInsertRowid, invoiceId: inv.lastInsertRowid, itemId: item.lastInsertRowid };
    })();

    createHoldingsForInvoice({ invoiceId, orderId, consumerId: req.consumer.id });
    markHoldingsDelivered(orderId);

    res.json({ success: true, order_id: orderId, product_name: product.name });
  } catch (err) { handleError(err, res); }
});

router.post('/containers/:id/trigger-refund', authConsumer, (req, res) => {
  try {
    const destination = req.body.destination || 'store_credit';
    const result = requestRefund({ holdingId: req.params.id, consumerId: req.consumer.id, destination, notes: '[Dev tool] test refund request' });
    res.json({ success: true, result });
  } catch (err) { handleError({ status: 400, message: err.message }, res); }
});

router.post('/containers/:id/trigger-dispute', authConsumer, (req, res) => {
  try {
    const result = openDamageDispute({ holdingId: req.params.id, consumerId: req.consumer.id, notes: '[Dev tool] test damage dispute' });
    res.json({ success: true, result });
  } catch (err) { handleError({ status: 400, message: err.message }, res); }
});

router.get('/containers/mine', authConsumer, (req, res) => {
  const holdings = db.prepare(`
    SELECT h.id, h.status, h.container_type, p.name AS product_name
      FROM container_holdings h JOIN products p ON p.id = h.current_product_id
     WHERE h.consumer_id = ? ORDER BY h.created_at DESC LIMIT 10
  `).all(req.consumer.id);
  res.json({ holdings });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Notifications
 * ═══════════════════════════════════════════════════════════════════════ */

const NOTIFICATION_TEMPLATES = {
  order_confirmed:    { title: 'Order confirmed', body: '[Dev tool] Your order has been confirmed.' },
  delivery_assigned:  { title: 'Dealer assigned', body: '[Dev tool] A dealer has been assigned to your order.' },
  welcome_gift_ready: { title: `${LUCKY_DRAW_NAME} welcome gift on its way`, body: '[Dev tool] Your welcome gift has been packed.' },
  referral_linked:    { title: 'Referral applied', body: '[Dev tool] A referral discount has been linked to your account.' },
};

router.post('/notifications/fire', authConsumer, (req, res) => {
  try {
    const { template, title, body } = req.body;
    const chosen = template && NOTIFICATION_TEMPLATES[template];
    if (!chosen && !(title && body)) throw httpError(400, 'Provide a known template, or a custom title + body');
    const t = chosen || { title, body };
    createNotification('consumer', req.consumer.id, t.title, t.body, { dev_tool: true });
    res.json({ success: true });
  } catch (err) { handleError(err, res); }
});
router.get('/notifications/templates', (_req, res) => res.json({ templates: Object.keys(NOTIFICATION_TEMPLATES) }));

module.exports = router;
