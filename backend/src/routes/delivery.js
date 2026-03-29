const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireTrader } = require('../middleware/auth');
const {
  notifyConsumerDeliveryAssigned,
} = require('../services/notificationService');
const { emitOrderUpdate, emitNotification } = require('../websocket/socketServer');

const router = express.Router();

/* ── All routes require authenticated trader ────────────────────────── */
router.use(authenticate, requireTrader);

/* ── Helpers ─────────────────────────────────────────────────────────── */

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
  return db.prepare(`
    SELECT co.* FROM consumer_orders co
    WHERE co.id = ? AND co.delivery_dealer_id = ?
  `).get(orderId, dealerId);
}

/* ═════════════════════════════════════════════════════════════════════
 * GET /delivery/orders/assigned
 * ═════════════════════════════════════════════════════════════════════ */
router.get('/orders/assigned', (req, res) => {
  try {
    const dealerId = req.user.id;
    const { delivery_status } = req.query;

    let sql = `
      SELECT co.*,
             c.name  AS consumer_name,
             c.phone AS consumer_phone
      FROM consumer_orders co
      LEFT JOIN consumers c ON c.id = co.consumer_id
      WHERE co.delivery_dealer_id = ?
    `;
    const params = [dealerId];

    if (delivery_status) {
      sql += ` AND co.delivery_status = ?`;
      params.push(delivery_status);
    }

    sql += ` ORDER BY co.created_at DESC`;

    const orders = db.prepare(sql).all(...params);

    // Attach items with product details for each order
    const itemStmt = db.prepare(`
      SELECT coi.*, p.name AS product_name, p.image_url, p.unit, p.category
      FROM consumer_order_items coi
      LEFT JOIN products p ON p.id = coi.product_id
      WHERE coi.order_id = ?
    `);

    for (const order of orders) {
      order.items = itemStmt.all(order.id);
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
      SELECT coi.*, p.name AS product_name, p.image_url, p.unit, p.category, p.description AS product_description
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

    const now = new Date().toISOString();
    const updates = { delivery_status: 'packed', delivery_packed_at: now, updated_at: now };

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
router.post('/orders/:id/start-delivery', param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = getAssignedOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    if (order.delivery_status !== 'packed') {
      return res.status(400).json({ error: `Cannot start delivery with delivery_status '${order.delivery_status}'. Must be 'packed'.` });
    }

    // Generate 6-digit OTP
    const plainOtp = generateOTP();
    const otpHash = bcrypt.hashSync(plainOtp, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

    db.prepare(`
      UPDATE consumer_orders
      SET delivery_status = 'out_for_delivery',
          delivery_started_at = ?,
          delivery_otp_hash = ?,
          delivery_otp_plain = ?,
          delivery_otp_expires_at = ?,
          delivery_otp_attempts = 0,
          status = 'shipped',
          updated_at = ?
      WHERE id = ?
    `).run(now.toISOString(), otpHash, plainOtp, expiresAt.toISOString(), now.toISOString(), order.id);

    // Send the PLAIN OTP to consumer via notification
    notifyConsumer(
      order.consumer_id,
      `Your delivery is on the way — ${order.order_number}`,
      `Your delivery OTP is: ${plainOtp}. Share this with the delivery partner upon arrival. Valid for 30 minutes.`,
      { orderNumber: order.order_number, delivery_status: 'out_for_delivery', otp: plainOtp }
    );

    emitOrderUpdate({
      orderId: order.id, orderNumber: order.order_number,
      status: 'shipped', deliveryStatus: 'out_for_delivery',
      consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
      deliveryDealerId: order.delivery_dealer_id,
      extra: { otpSent: true },
    });

    // Do NOT return the OTP to the delivery app
    res.json({ success: true, message: 'Delivery started. OTP sent to consumer.' });
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
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const order = getAssignedOrder(req.params.id, req.user.id);
      if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

      if (order.delivery_status !== 'out_for_delivery') {
        return res.status(400).json({ error: `Cannot verify OTP with delivery_status '${order.delivery_status}'. Must be 'out_for_delivery'.` });
      }

      // Check brute force limit
      if ((order.delivery_otp_attempts || 0) >= 5) {
        return res.status(429).json({ error: 'Maximum OTP attempts exceeded. Please contact support.' });
      }

      // Check expiry
      const expiresAt = new Date(order.delivery_otp_expires_at);
      if (expiresAt <= new Date()) {
        return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      }

      // Compare OTP with bcrypt
      const isValid = bcrypt.compareSync(req.body.otp, order.delivery_otp_hash);

      if (!isValid) {
        // Increment attempts
        db.prepare(`
          UPDATE consumer_orders
          SET delivery_otp_attempts = delivery_otp_attempts + 1, updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), order.id);

        const remaining = 4 - (order.delivery_otp_attempts || 0);
        return res.status(400).json({
          error: 'Invalid OTP',
          attempts_remaining: Math.max(remaining, 0),
        });
      }

      // OTP correct — mark delivered, clear plain OTP
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE consumer_orders
        SET delivery_status = 'delivered',
            delivery_verified_at = ?,
            delivery_otp_plain = NULL,
            status = 'delivered',
            updated_at = ?
        WHERE id = ?
      `).run(now, now, order.id);

      notifyConsumer(
        order.consumer_id,
        `Order delivered — ${order.order_number}`,
        `Your order has been successfully delivered. Thank you!`,
        { orderNumber: order.order_number, delivery_status: 'delivered' }
      );
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
router.post('/orders/:id/resend-otp', param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const order = getAssignedOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });

    if (order.delivery_status !== 'out_for_delivery') {
      return res.status(400).json({ error: 'Order is not out for delivery' });
    }

    const now = new Date();
    let plainOtp = order.delivery_otp_plain;

    // If OTP expired or plain text not available, generate a new one
    if (!plainOtp || new Date(order.delivery_otp_expires_at) <= now) {
      plainOtp = generateOTP();
      const otpHash  = bcrypt.hashSync(plainOtp, 10);
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
      db.prepare(`
        UPDATE consumer_orders
        SET delivery_otp_hash = ?,
            delivery_otp_plain = ?,
            delivery_otp_expires_at = ?,
            delivery_otp_attempts = 0,
            updated_at = ?
        WHERE id = ?
      `).run(otpHash, plainOtp, expiresAt.toISOString(), now.toISOString(), order.id);
    }

    notifyConsumer(
      order.consumer_id,
      `Delivery OTP — ${order.order_number}`,
      `Your delivery OTP is: ${plainOtp}. Share this with the delivery partner to complete the delivery.`,
      { orderNumber: order.order_number, delivery_status: 'out_for_delivery', otp: plainOtp }
    );

    res.json({ success: true, message: 'OTP sent to customer via notification' });
  } catch (err) {
    console.error('POST /delivery/orders/:id/resend-otp error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

module.exports = router;
