const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireTraderOrAdmin } = require('../middleware/auth');
const { deductOrderInventory } = require('../services/inventoryService');
const {
  notifyConsumerDeliveryAssigned,
} = require('../services/notificationService');
const { emitOrderUpdate, emitNotification, emitContainerHoldingUpdate } = require('../websocket/socketServer');
const { sendDeliveryOtpEmail, sendOutForDeliveryEmail } = require('../services/emailService');
const {
  markHoldingsDelivered,
  getPendingPickups,
  finalizeRefund,
} = require('../services/containerHoldingsService');
const { uploadProof } = require('../middleware/uploadProof');
const { sendAdminDamageReportEmail } = require('../services/emailService');

const router = express.Router();

/* ═════════════════════════════════════════════════════════════════════
 * Admin-delivery commission routing.
 *
 * Business rule: when a consumer order is delivered by a user with
 * role='admin' (which happens for direct orders and for admin
 * takeovers), the commission for that order belongs to the founder
 * account (barathichiru@gmail.com, referral A0000). The linked dealer
 * did not do the delivery work; the founder / admin did.
 *
 * Behaviour:
 *   - Only touches commissions that are still `pending` (never
 *     `transferred` / `confirmed` — those are already paid out).
 *   - If a pending commission exists on the order, its trader_id is
 *     reassigned to the founder.
 *   - If the order is a direct order (no linked dealer, no commission
 *     was ever created), a fresh 'direct' pending commission is created
 *     at the founder's own commission_rate.
 *
 * Keyed strictly on email — there are multiple users named "Chiranth";
 * only the founder account (referral A0000) should catch this routing.
 * ═════════════════════════════════════════════════════════════════════ */
const ADMIN_DELIVERY_COMMISSION_EMAIL = 'barathichiru@gmail.com';

function rerouteAdminDeliveryCommission(order, deliveringUser) {
  if (!deliveringUser || deliveringUser.role !== 'admin') return;

  const founder = db.prepare(
    `SELECT id, commission_rate FROM users WHERE email = ?`
  ).get(ADMIN_DELIVERY_COMMISSION_EMAIL);

  if (!founder) {
    console.error(
      `[commission] admin-delivery reroute: founder account ${ADMIN_DELIVERY_COMMISSION_EMAIL} not found; skipping`
    );
    return;
  }

  const result = db.prepare(`
    UPDATE commissions
       SET trader_id = ?
     WHERE consumer_order_id = ?
       AND status = 'pending'
  `).run(founder.id, order.id);

  const anyExisting = db.prepare(
    `SELECT COUNT(*) AS n FROM commissions WHERE consumer_order_id = ?`
  ).get(order.id);

  if (anyExisting.n === 0) {
    /* Direct order that admin delivered: no commission ever created.
     * Insert one for the founder at their own rate. */
    const now = new Date();
    const ws  = new Date(now); ws.setDate(now.getDate() - now.getDay() + 1);
    const we  = new Date(ws);  we.setDate(ws.getDate() + 6);
    const weekStart = ws.toISOString().slice(0, 10);
    const weekEnd   = we.toISOString().slice(0, 10);
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
  } else if (result.changes > 0) {
    console.log(
      `[commission] admin-delivery: rerouted ${result.changes} pending commission(s) on order ${order.id} to founder`
    );
  }
}

/* ── All routes require authenticated trader or admin ───────────────── */
router.use(authenticate, requireTraderOrAdmin);

/* ── Helpers ─────────────────────────────────────────────────────────── */

/**
 * Per-line type tag for a consumer_order_item.
 *
 *   refill   — consumer brings their held container; container_cost is 0
 *   new      — fresh container, consumer paid container_cost
 *   standard — product without a container (or container info missing)
 */
function classifyLine(item) {
  if (item.is_refill === 1 || item.is_refill === true) return 'refill';
  if ((item.container_cost || 0) > 0) return 'new';
  return 'standard';
}

/**
 * Other open requests for the same consumer that the driver should be
 * aware of: open consumer_orders (excluding the current one) and any
 * standalone container pickups (refund_requested holdings).
 *
 *   excludeOrderId    : skip this consumer_order from the result
 *   excludeHoldingId  : skip this container_holdings row from the result
 *
 * Each entry carries `kind` ('delivery' | 'pickup') and `id` so the UI
 * can deep-link to the matching card on the dashboard.
 */
function getConsumerPendingElsewhere({ consumerId, viewerId, viewerRole, excludeOrderId = null, excludeHoldingId = null }) {
  /* Scope to the viewer: a delivery driver should only see their own
   * assigned orders + pickups in the cross-reference footer. Admins
   * see everything (they're not picking these cards to act on). */
  const isAdmin = viewerRole === 'admin';
  const ordersSql = `
    SELECT co.id, co.order_number, co.delivery_status, co.total_amount, co.created_at,
           (SELECT COUNT(*) FROM consumer_order_items oi WHERE oi.order_id=co.id) AS item_count
      FROM consumer_orders co
     WHERE co.consumer_id = ?
       AND co.payment_status = 'paid'
       AND co.status NOT IN ('cancelled')
       AND co.delivery_status NOT IN ('delivered','failed','cancelled')
       AND co.id != COALESCE(?, -1)
       ${isAdmin ? '' : 'AND co.delivery_dealer_id = ?'}
     ORDER BY co.created_at DESC
  `;
  const orderArgs = isAdmin ? [consumerId, excludeOrderId] : [consumerId, excludeOrderId, viewerId];
  const orders = db.prepare(ordersSql).all(...orderArgs);

  const pickupsSql = `
    SELECT h.id, h.container_type, h.deposit_amount, h.refund_destination,
           h.requested_at, h.created_at,
           p_cur.name AS current_product_name
      FROM container_holdings h
      JOIN consumers c    ON c.id = h.consumer_id
      JOIN products p_cur ON p_cur.id = h.current_product_id
     WHERE h.consumer_id = ?
       AND h.status = 'refund_requested'
       AND h.id != COALESCE(?, -1)
       ${isAdmin ? '' : 'AND c.linked_dealer_id = ?'}
     ORDER BY h.requested_at ASC, h.id ASC
  `;
  const pickupArgs = isAdmin ? [consumerId, excludeHoldingId] : [consumerId, excludeHoldingId, viewerId];
  const pickups = db.prepare(pickupsSql).all(...pickupArgs);

  return [
    ...orders.map(o => ({
      kind: 'delivery',
      id: o.id,
      order_number: o.order_number,
      summary: `${o.item_count} item${o.item_count === 1 ? '' : 's'} · ₹${Math.round(o.total_amount)}`,
      status: o.delivery_status,
      created_at: o.created_at,
    })),
    ...pickups.map(p => ({
      kind: 'pickup',
      id: p.id,
      summary: `Refund ${p.container_type} (${p.current_product_name}) · ₹${Math.round(p.deposit_amount)}`,
      destination: p.refund_destination,
      created_at: p.requested_at || p.created_at,
    })),
  ];
}

/** Send a notification to a consumer (DB + real-time push) */
function notifyConsumer(consumerId, title, bodyText, data = {}) {
  const r = db.prepare(`
    INSERT INTO notifications (user_type, user_id, title, body, data, channel)
    VALUES ('consumer', ?, ?, ?, ?, 'in_app')
  `).run(consumerId, title, bodyText, JSON.stringify(data));
  // Push via WebSocket
  emitNotification('consumer', consumerId, {
    id: r.lastInsertRowid, title, body: bodyText, data, created_at: new Date().toISOString(),
  });
  console.log(`[NOTIFICATION] Consumer id=${consumerId}: ${title}`);
}

/** Generate a random 6-digit OTP */
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Load an order assigned to the current delivery dealer */
function getAssignedOrder(orderId, dealerId) {
  const order = db.prepare(`
    SELECT co.*, c.phone AS consumer_phone, c.email AS consumer_email, c.name AS consumer_name
    FROM consumer_orders co
    LEFT JOIN consumers c ON c.id = co.consumer_id
    WHERE co.id = ? AND co.delivery_dealer_id = ?
  `).get(orderId, dealerId);
  if (order) {
    // Fall back to consumer's registered phone if delivery address has no phone
    order.otp_phone = order.delivery_phone || order.consumer_phone;
  }
  return order;
}

/* ═════════════════════════════════════════════════════════════════════
 * GET /delivery/fleet/orders   (admin-only)
 *
 * Returns active delivery orders across ALL dealers with assignment state.
 * Used by the admin delivery dashboard to monitor the whole fleet.
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/fleet/orders', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const orders = db.prepare(`
      SELECT co.id, co.order_number, co.status AS order_status,
             co.delivery_status, co.total_amount, co.delivery_address,
             co.created_at, co.delivery_dealer_id,
             co.original_delivery_dealer_id, co.admin_taken_over_at,
             c.name  AS consumer_name,
             c.phone AS consumer_phone,
             u.name  AS dealer_name,
             u.phone AS dealer_phone,
             u.role  AS dealer_role,
             ou.name AS original_dealer_name
      FROM consumer_orders co
      LEFT JOIN consumers c ON c.id = co.consumer_id
      LEFT JOIN users u     ON u.id = co.delivery_dealer_id
      LEFT JOIN users ou    ON ou.id = co.original_delivery_dealer_id
      WHERE co.payment_status = 'paid'
        AND co.status NOT IN ('cancelled')
        AND co.delivery_status IN ('pending','accepted','packed','out_for_delivery')
      ORDER BY co.created_at DESC
      LIMIT 200
    `).all();

    res.json({ orders });
  } catch (err) {
    console.error('GET /delivery/fleet/orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/takeover
 * Admin-only. Reassigns delivery_dealer_id to the admin while preserving
 * the original driver's id in original_delivery_dealer_id so they still
 * see the order on their dashboard (read-only). Idempotent — calling
 * twice has no extra effect.
 * ═════════════════════════════════════════════════════════════════════ */
router.post('/orders/:id/takeover', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const orderId = parseInt(req.params.id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: 'Invalid order id' });
  }

  try {
    const order = db.prepare(`SELECT * FROM consumer_orders WHERE id = ?`).get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.delivery_dealer_id === req.user.id) {
      return res.json({ ok: true, message: 'Already assigned to you', order });
    }

    const previousDealerId = order.delivery_dealer_id;
    const originalToPreserve = order.original_delivery_dealer_id || previousDealerId;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE consumer_orders
         SET original_delivery_dealer_id = ?,
             delivery_dealer_id          = ?,
             admin_taken_over_at         = ?,
             updated_at                  = ?
       WHERE id = ?
    `).run(originalToPreserve, req.user.id, now, now, order.id);

    const updated = db.prepare(`SELECT * FROM consumer_orders WHERE id = ?`).get(order.id);

    emitOrderUpdate({
      orderId: updated.id,
      orderNumber: updated.order_number,
      status: updated.status,
      deliveryStatus: updated.delivery_status,
      consumerId: updated.consumer_id,
      linkedDealerId: updated.linked_dealer_id,
      deliveryDealerId: updated.delivery_dealer_id,
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    console.error('POST /delivery/orders/:id/takeover error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * GET /delivery/orders/assigned
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/orders/assigned', (req, res) => {
  try {
    const dealerId = req.user.id;
    const { delivery_status } = req.query;

    /* Drivers see orders directly assigned to them, AND orders that were
     * previously assigned to them but admin has taken over (read-only, so
     * the driver knows what happened to their queue). */
    let sql = `
      SELECT co.*,
             c.name  AS consumer_name,
             c.phone AS consumer_phone,
             admin_u.name AS admin_takeover_name
      FROM consumer_orders co
      LEFT JOIN consumers c ON c.id = co.consumer_id
      LEFT JOIN users admin_u ON admin_u.id = co.delivery_dealer_id AND co.admin_taken_over_at IS NOT NULL
      WHERE (co.delivery_dealer_id = ? OR co.original_delivery_dealer_id = ?)
        AND co.payment_status = 'paid'
        AND co.status NOT IN ('cancelled')
    `;
    const params = [dealerId, dealerId];

    if (delivery_status) {
      sql += ` AND co.delivery_status = ?`;
      params.push(delivery_status);
    }

    sql += ` ORDER BY co.created_at DESC`;

    const orders = db.prepare(sql).all(...params);

    /* Flag read-only orders: ones admin has taken over and the viewer is
     * the original driver (not the current delivery_dealer_id). */
    for (const o of orders) {
      o.read_only = !!(o.admin_taken_over_at && o.delivery_dealer_id !== dealerId);
    }

    // Attach items with product details for each order
    const itemStmt = db.prepare(`
      SELECT coi.*, p.name AS product_name, p.image_url, p.unit, p.category,
             p.container_type
      FROM consumer_order_items coi
      LEFT JOIN products p ON p.id = coi.product_id
      WHERE coi.order_id = ?
    `);

    for (const order of orders) {
      const items = itemStmt.all(order.id);
      order.items = items.map(it => ({ ...it, line_type: classifyLine(it) }));
      order.consumer_pending_elsewhere = getConsumerPendingElsewhere({
        consumerId: order.consumer_id,
        viewerId: req.user.id,
        viewerRole: req.user.role,
        excludeOrderId: order.id,
      });
    }

    res.json({ orders });
  } catch (err) {
    console.error('GET /delivery/orders/assigned error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * GET /delivery/orders/:id
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/orders/:id', param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = db.prepare(`
      SELECT co.*,
             c.name  AS consumer_name,
             c.phone AS consumer_phone,
             c.email AS consumer_email
      FROM consumer_orders co
      LEFT JOIN consumers c ON c.id = co.consumer_id
      WHERE co.id = ? AND co.delivery_dealer_id = ?
    `).get(req.params.id, req.user.id);

    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    // Items with product details
    order.items = db.prepare(`
      SELECT coi.*, p.name AS product_name, p.image_url, p.unit, p.category,
             p.description AS product_description, p.container_type
      FROM consumer_order_items coi
      LEFT JOIN products p ON p.id = coi.product_id
      WHERE coi.order_id = ?
    `).all(order.id);

    // Delivery timeline
    order.timeline = {
      created_at: order.created_at,
      delivery_accepted_at: order.delivery_accepted_at,
      delivery_packed_at: order.delivery_packed_at,
      delivery_started_at: order.delivery_started_at,
      delivery_verified_at: order.delivery_verified_at,
      delivery_status: order.delivery_status,
    };

    res.json({ order });
  } catch (err) {
    console.error('GET /delivery/orders/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/accept
 * ═════════════════════════════════════════════════════════════════════ */
router.post('/orders/:id/accept', param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = getAssignedOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    if (order.delivery_status !== 'pending') {
      return res.status(400).json({ error: `Cannot accept order with delivery_status '${order.delivery_status}'. Must be 'pending'.` });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE consumer_orders
      SET delivery_status = 'accepted', delivery_accepted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, order.id);

    // Real-time + DB notification
    notifyConsumer(
      order.consumer_id,
      `Delivery accepted — ${order.order_number}`,
      `Your delivery partner has accepted your order and will begin preparing it.`,
      { orderNumber: order.order_number, delivery_status: 'accepted' }
    );
    emitOrderUpdate({
      orderId: order.id, orderNumber: order.order_number,
      status: order.status, deliveryStatus: 'accepted',
      consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
      deliveryDealerId: order.delivery_dealer_id,
    });

    res.json({ success: true, message: 'Delivery accepted' });
  } catch (err) {
    console.error('POST /delivery/orders/:id/accept error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/packed
 * ═════════════════════════════════════════════════════════════════════ */
router.post('/orders/:id/packed', param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = getAssignedOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    if (order.delivery_status !== 'accepted') {
      return res.status(400).json({ error: `Cannot mark as packed with delivery_status '${order.delivery_status}'. Must be 'accepted'.` });
    }

    // Deduct dealer inventory before packing (same check as trader route)
    const fulfillDealerId = order.delivery_dealer_id || order.linked_dealer_id;
    if (fulfillDealerId) {
      try {
        deductOrderInventory(order.id, fulfillDealerId);
      } catch (invErr) {
        // Email admin about the stock shortage (non-blocking)
        try {
          const { sendAdminStockAlert } = require('../services/emailService');
          const dealer = db.prepare('SELECT name FROM users WHERE id=?').get(fulfillDealerId);
          sendAdminStockAlert({
            dealerName:   dealer?.name || `Dealer #${fulfillDealerId}`,
            orderNumber:  order.order_number,
            errorMessage: invErr.message,
          }).catch(() => {});
        } catch { /* non-fatal */ }
        return res.status(400).json({
          error: invErr.message,
          hint: 'Not enough stock to pack this order. Admin needs to restock first.',
        });
      }
    }

    const now = new Date().toISOString();

    // Also update main order status if it's 'confirmed'
    let statusUpdate = '';
    if (order.status === 'confirmed') {
      statusUpdate = `, status = 'processing'`;
    }

    db.prepare(`
      UPDATE consumer_orders
      SET delivery_status = 'packed', delivery_packed_at = ?, updated_at = ? ${statusUpdate}
      WHERE id = ?
    `).run(now, now, order.id);

    notifyConsumer(
      order.consumer_id,
      `Order packed — ${order.order_number}`,
      `Your order has been packed and is almost ready for delivery.`,
      { orderNumber: order.order_number, delivery_status: 'packed' }
    );
    emitOrderUpdate({
      orderId: order.id, orderNumber: order.order_number,
      status: statusUpdate ? 'processing' : order.status, deliveryStatus: 'packed',
      consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
      deliveryDealerId: order.delivery_dealer_id,
    });

    res.json({ success: true, message: 'Order marked as packed' });
  } catch (err) {
    console.error('POST /delivery/orders/:id/packed error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/start-delivery
 * ═════════════════════════════════════════════════════════════════════ */
router.post('/orders/:id/start-delivery', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = getAssignedOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    if (order.delivery_status !== 'packed') {
      return res.status(400).json({ error: `Cannot start delivery with delivery_status '${order.delivery_status}'. Must be 'packed'.` });
    }

    // Generate OTP locally — consumer will see it in their app
    const otp = generateOTP();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE consumer_orders
      SET delivery_status = 'out_for_delivery',
          delivery_started_at = ?,
          delivery_otp = ?,
          status = 'shipped',
          updated_at = ?
      WHERE id = ?
    `).run(now, otp, now, order.id);

    // Notify consumer — in-app notification + email with OTP
    if (order.consumer_id) {
      notifyConsumer(
        order.consumer_id,
        `Your delivery is on the way — ${order.order_number}`,
        `Your order is out for delivery. Your delivery code is: ${otp}. Show this to the delivery agent.`,
        { orderNumber: order.order_number, delivery_status: 'out_for_delivery', otp }
      );
    }
    // Fetch consumer directly to guarantee email is populated (JOIN alias can be unreliable)
    const consumer = db.prepare('SELECT name, email FROM consumers WHERE id = ?').get(order.consumer_id);
    if (consumer?.email) {
      sendOutForDeliveryEmail(consumer.email, consumer.name, order.order_number)
        .catch(err => console.error('[delivery] out-for-delivery email failed:', err.message));
      sendDeliveryOtpEmail(consumer.email, consumer.name, otp, order.order_number)
        .catch(err => console.error('[delivery] OTP email failed:', err.message));
    } else {
      console.warn('[delivery] no consumer email found for consumer_id', order.consumer_id);
    }

    emitOrderUpdate({
      orderId: order.id, orderNumber: order.order_number,
      status: 'shipped', deliveryStatus: 'out_for_delivery',
      consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
      deliveryDealerId: order.delivery_dealer_id,
    });

    res.json({ success: true, message: 'Delivery started. Consumer has been notified with their delivery code.' });
  } catch (err) {
    console.error('POST /delivery/orders/:id/start-delivery error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/verify-otp
 * ═════════════════════════════════════════════════════════════════════ */
router.post(
  '/orders/:id/verify-otp',
  param('id').isInt(),
  body('otp').isString().isLength({ min: 6, max: 6 }).withMessage('OTP must be a 6-digit string'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const order = getAssignedOrder(req.params.id, req.user.id);
      if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

      if (order.delivery_status !== 'out_for_delivery') {
        return res.status(400).json({ error: `Cannot verify OTP with delivery_status '${order.delivery_status}'. Must be 'out_for_delivery'.` });
      }

      // Verify OTP against the code stored in the order
      if (!order.delivery_otp || String(req.body.otp) !== String(order.delivery_otp)) {
        return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
      }

      // OTP correct — mark delivered
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE consumer_orders
        SET delivery_status = 'delivered',
            delivery_verified_at = ?,
            delivery_otp = NULL,
            status = 'delivered',
            updated_at = ?
        WHERE id = ?
      `).run(now, now, order.id);

      /* Flip pending_delivery container holdings to 'held' — physical
       * containers are now with the consumer. Non-fatal on error. */
      try { markHoldingsDelivered(order.id); }
      catch (err) { console.error(`[delivery] markHoldingsDelivered failed for order ${order.id}:`, err.message); }

      /* Reroute the commission to the founder account when admin
       * delivered this order. Non-fatal on error — we don't want a
       * commission bookkeeping issue to block delivery confirmation. */
      try { rerouteAdminDeliveryCommission(order, req.user); }
      catch (err) { console.error(`[commission] admin-delivery reroute failed for order ${order.id}:`, err.message); }

      if (order.consumer_id) {
        notifyConsumer(
          order.consumer_id,
          `Order delivered — ${order.order_number}`,
          `Your order has been successfully delivered. Thank you for shopping with Sanathana Tattva!`,
          { orderNumber: order.order_number, delivery_status: 'delivered' }
        );
      }
      emitOrderUpdate({
        orderId: order.id, orderNumber: order.order_number,
        status: 'delivered', deliveryStatus: 'delivered',
        consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
        deliveryDealerId: order.delivery_dealer_id,
      });

      res.json({ success: true, message: 'Delivery verified and completed' });
    } catch (err) {
      console.error('POST /delivery/orders/:id/verify-otp error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/resend-otp
 * Resends the delivery OTP to the consumer via notification.
 * If the OTP has expired, generates a fresh one.
 * ═════════════════════════════════════════════════════════════════════ */
router.post('/orders/:id/resend-otp', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = getAssignedOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    if (order.delivery_status !== 'out_for_delivery') {
      return res.status(400).json({ error: 'Order is not out for delivery' });
    }

    // Generate a fresh OTP and update the order
    const newOtp = generateOTP();
    const now2   = new Date().toISOString();
    db.prepare('UPDATE consumer_orders SET delivery_otp = ?, updated_at = ? WHERE id = ?')
      .run(newOtp, now2, order.id);

    if (order.consumer_id) {
      notifyConsumer(
        order.consumer_id,
        `New delivery code — ${order.order_number}`,
        `Your new delivery code is: ${newOtp}. Show this to the delivery agent.`,
        { orderNumber: order.order_number, delivery_status: 'out_for_delivery', otp: newOtp }
      );
    }

    if (order.consumer_email) {
      sendDeliveryOtpEmail(order.consumer_email, order.consumer_name, newOtp, order.order_number)
        .catch(err => console.error('[delivery] resend OTP email failed:', err.message));
    } else {
      console.warn('[delivery] resend-otp: no consumer email for consumer_id', order.consumer_id);
    }

    res.json({ success: true, message: 'New delivery code sent to consumer (in-app + email)' });
  } catch (err) {
    console.error('POST /delivery/orders/:id/resend-otp error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * POST /delivery/orders/:id/fail
 * ═════════════════════════════════════════════════════════════════════ */
router.post(
  '/orders/:id/fail',
  param('id').isInt(),
  body('reason').isString().notEmpty().withMessage('Failure reason is required'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const order = getAssignedOrder(req.params.id, req.user.id);
      if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

      if (order.delivery_status !== 'out_for_delivery') {
        return res.status(400).json({ error: `Cannot mark as failed with delivery_status '${order.delivery_status}'. Must be 'out_for_delivery'.` });
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE consumer_orders
        SET delivery_status = 'failed',
            delivery_failed_reason = ?,
            updated_at = ?
        WHERE id = ?
      `).run(req.body.reason, now, order.id);

      notifyConsumer(
        order.consumer_id,
        `Delivery failed — ${order.order_number}`,
        `Unfortunately, your delivery could not be completed. Reason: ${req.body.reason}`,
        { orderNumber: order.order_number, delivery_status: 'failed', reason: req.body.reason }
      );
      emitOrderUpdate({
        orderId: order.id, orderNumber: order.order_number,
        status: order.status, deliveryStatus: 'failed',
        consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
        deliveryDealerId: order.delivery_dealer_id,
        extra: { failReason: req.body.reason },
      });

      res.json({ success: true, message: 'Delivery marked as failed' });
    } catch (err) {
      console.error('POST /delivery/orders/:id/fail error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/* ═════════════════════════════════════════════════════════════════════
 * GET /delivery/stats
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/stats', (req, res) => {
  try {
    const dealerId = req.user.id;

    const total = db.prepare(`
      SELECT COUNT(*) AS count FROM consumer_orders WHERE delivery_dealer_id = ?
    `).get(dealerId).count;

    const completed = db.prepare(`
      SELECT COUNT(*) AS count FROM consumer_orders
      WHERE delivery_dealer_id = ? AND delivery_status = 'delivered'
    `).get(dealerId).count;

    const pending = db.prepare(`
      SELECT COUNT(*) AS count FROM consumer_orders
      WHERE delivery_dealer_id = ? AND delivery_status IN ('pending', 'accepted', 'packed', 'out_for_delivery')
    `).get(dealerId).count;

    const failed = db.prepare(`
      SELECT COUNT(*) AS count FROM consumer_orders
      WHERE delivery_dealer_id = ? AND delivery_status = 'failed'
    `).get(dealerId).count;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayDeliveries = db.prepare(`
      SELECT COUNT(*) AS count FROM consumer_orders
      WHERE delivery_dealer_id = ? AND delivery_status = 'delivered' AND delivery_verified_at >= ?
    `).get(dealerId, todayStart.toISOString()).count;

    // Average delivery time (from accepted to verified, in minutes)
    const avgResult = db.prepare(`
      SELECT AVG(
        (julianday(delivery_verified_at) - julianday(delivery_accepted_at)) * 24 * 60
      ) AS avg_minutes
      FROM consumer_orders
      WHERE delivery_dealer_id = ?
        AND delivery_status = 'delivered'
        AND delivery_verified_at IS NOT NULL
        AND delivery_accepted_at IS NOT NULL
    `).get(dealerId);

    const avgDeliveryMinutes = avgResult.avg_minutes ? Math.round(avgResult.avg_minutes) : null;

    res.json({
      stats: {
        total_deliveries: total,
        completed,
        pending,
        failed,
        today_deliveries: todayDeliveries,
        avg_delivery_minutes: avgDeliveryMinutes,
      },
    });
  } catch (err) {
    console.error('GET /delivery/stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * GET /delivery/history
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/history', (req, res) => {
  try {
    const dealerId = req.user.id;
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const totalRow = db.prepare(`
      SELECT COUNT(*) AS count FROM consumer_orders
      WHERE delivery_dealer_id = ? AND delivery_status IN ('delivered', 'failed')
    `).get(dealerId);

    const orders = db.prepare(`
      SELECT co.*,
             c.name  AS consumer_name,
             c.phone AS consumer_phone
      FROM consumer_orders co
      LEFT JOIN consumers c ON c.id = co.consumer_id
      WHERE co.delivery_dealer_id = ? AND co.delivery_status IN ('delivered', 'failed')
      ORDER BY co.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(dealerId, limit, offset);

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total: totalRow.count,
        total_pages: Math.ceil(totalRow.count / limit),
      },
    });
  } catch (err) {
    console.error('GET /delivery/history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * Container pickups (Phase 6)
 *
 * Refund_requested holdings show up as pickup tasks for the linked dealer
 * (and to all admins). The dealer goes to the consumer, inspects the
 * container, and posts the outcome: 'refunded' (good condition) or
 * 'forfeited' (damaged/missing). Store-credit refunds settle the ledger
 * atomically inside finalizeRefund.
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/container-pickups', (req, res) => {
  try {
    const rows = getPendingPickups({ userId: req.user.id, role: req.user.role });
    for (const r of rows) {
      r.consumer_pending_elsewhere = getConsumerPendingElsewhere({
        consumerId: r.consumer_id,
        viewerId: req.user.id,
        viewerRole: req.user.role,
        excludeHoldingId: r.id,
      });
    }
    res.json({ pickups: rows });
  } catch (err) {
    console.error('GET /delivery/container-pickups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/container-pickups/:id/resolve',
  uploadProof('photo', 'pickups'),
  param('id').isInt(),
  body('outcome').isIn(['refunded', 'forfeited']),
  body('destination').optional().isIn(['manual_bank', 'store_credit', 'manual_upi']),
  body('notes').optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const outcome = req.body.outcome;
      const photoUrl = req.file ? req.file.url : null;
      const result = finalizeRefund({
        holdingId: Number(req.params.id),
        resolvedByUserId: req.user.id,
        resolvedByRole: req.user.role,
        outcome,
        notes: req.body.notes,
        overrideDestination: req.body.destination || undefined,
        refundProofUrl: outcome === 'refunded' ? photoUrl : null,
        damagePhotoUrl: outcome === 'forfeited' ? photoUrl : null,
      });

      /* Damage path → admin email. Send asynchronously; don't block the
       * response on SMTP. Logged on failure but not surfaced to driver. */
      if (outcome === 'forfeited') {
        try {
          const ctx = db.prepare(`
            SELECT h.id, h.container_type, h.deposit_amount, h.dispute_deadline,
                   c.name AS consumer_name, c.phone AS consumer_phone,
                   u.name AS driver_name
              FROM container_holdings h
              JOIN consumers c ON c.id = h.consumer_id
              LEFT JOIN users u ON u.id = h.driver_user_id
             WHERE h.id = ?
          `).get(Number(req.params.id));
          const publicBase = process.env.PUBLIC_API_URL || '';
          sendAdminDamageReportEmail({
            driverName: ctx.driver_name,
            consumerName: ctx.consumer_name,
            consumerPhone: ctx.consumer_phone,
            holdingId: ctx.id,
            containerType: ctx.container_type,
            depositAmount: ctx.deposit_amount,
            damagePhotoUrl: photoUrl ? `${publicBase}${photoUrl}` : null,
            disputeDeadline: ctx.dispute_deadline,
            notes: req.body.notes,
          }).catch(err => console.error('[damage-email] failed:', err.message));
        } catch (e) {
          console.error('[damage-email] context lookup failed:', e.message);
        }
      }

      try {
        const ctx2 = db.prepare(`
          SELECT h.consumer_id, c.linked_dealer_id
            FROM container_holdings h
            JOIN consumers c ON c.id = h.consumer_id
           WHERE h.id = ?
        `).get(Number(req.params.id));
        emitContainerHoldingUpdate({
          holdingId:      Number(req.params.id),
          consumerId:     ctx2?.consumer_id,
          linkedDealerId: ctx2?.linked_dealer_id,
          event:          `pickup_${outcome}`,
        });
      } catch (_) { /* non-fatal */ }

      res.json({ ...result, photoUrl });
    } catch (err) {
      if (err.code === 'NOT_FOUND')           return res.status(404).json({ error: err.message });
      if (err.code === 'FORBIDDEN')           return res.status(403).json({ error: err.message });
      if (err.code === 'INVALID_STATUS')      return res.status(400).json({ error: err.message });
      if (err.code === 'INVALID_OUTCOME')     return res.status(400).json({ error: err.message });
      if (err.code === 'INVALID_DESTINATION') return res.status(400).json({ error: err.message });
      if (err.code === 'PROOF_REQUIRED')      return res.status(400).json({ error: err.message });
      console.error('POST /delivery/container-pickups/:id/resolve error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
