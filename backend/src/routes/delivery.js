const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireTraderOrAdmin } = require('../middleware/auth');
const { deductOrderInventory } = require('../services/inventoryService');
const {
  notifyConsumerDeliveryAssigned,
} = require('../services/notificationService');
const { emitOrderUpdate, emitNotification } = require('../websocket/socketServer');
const { sendDeliveryOtpEmail, sendOutForDeliveryEmail } = require('../services/emailService');

const router = express.Router();

/* ── All routes require authenticated trader or admin ───────────────── */
router.use(authenticate, requireTraderOrAdmin);

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
             c.name  AS consumer_name,
             c.phone AS consumer_phone,
             u.name  AS dealer_name,
             u.phone AS dealer_phone,
             u.role  AS dealer_role
      FROM consumer_orders co
      LEFT JOIN consumers c ON c.id = co.consumer_id
      LEFT JOIN users u     ON u.id = co.delivery_dealer_id
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
        AND co.payment_status = 'paid'
        AND co.status NOT IN ('cancelled')
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

module.exports = router;
