const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const db       = require('../database/db');
const { createNotification } = require('../services/notificationService');

const router = express.Router();

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

/* ── Consumer auth (same inline pattern as notifications.js) ─────────── */
const authConsumer = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'consumer')
      return res.status(403).json({ error: 'Consumer access only' });
    const c = db.prepare('SELECT * FROM consumers WHERE id=? AND status=?')
      .get(decoded.id, 'active');
    if (!c) return res.status(401).json({ error: 'Consumer not found' });
    req.consumer = c;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/* ── POST /api/payments/create-order ─────────────────────────────────── */
router.post('/create-order', authConsumer, async (req, res) => {
  const { consumer_order_id } = req.body;
  if (!consumer_order_id)
    return res.status(400).json({ error: 'consumer_order_id is required' });

  const order = db.prepare(
    'SELECT * FROM consumer_orders WHERE id=? AND consumer_id=?'
  ).get(consumer_order_id, req.consumer.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment_status === 'paid')
    return res.status(400).json({ error: 'Order is already paid' });

  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });

  try {
    const rzpOrder = await razorpay.orders.create({
      amount:   Math.round(order.total_amount * 100), // paise
      currency: 'INR',
      receipt:  `rcpt_${order.order_number}`,
    });

    res.json({
      razorpay_order_id: rzpOrder.id,
      amount:            rzpOrder.amount,
      currency:          rzpOrder.currency,
      key_id:            process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('[razorpay] create-order error:', err.message);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

/* ── POST /api/payments/verify ───────────────────────────────────────── */
router.post('/verify', authConsumer, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, consumer_order_id } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !consumer_order_id)
    return res.status(400).json({ error: 'Missing required fields' });

  /* Verify HMAC-SHA256 signature */
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed' });

  const order = db.prepare(
    'SELECT * FROM consumer_orders WHERE id=? AND consumer_id=?'
  ).get(consumer_order_id, req.consumer.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });

  /* Mark order as paid + confirmed, insert commissions — all in one transaction */
  db.transaction(() => {
    db.prepare(`
      UPDATE consumer_orders
      SET payment_status='paid', status='confirmed',
          razorpay_order_id=?, razorpay_payment_id=?
      WHERE id=?
    `).run(razorpay_order_id, razorpay_payment_id, consumer_order_id);

    /* Record commissions now that payment is confirmed */
    if (!order.is_direct && order.linked_dealer_id) {
      const dealer = db.prepare('SELECT * FROM users WHERE id=?').get(order.linked_dealer_id);
      if (dealer) {
        const now = new Date();
        const ws  = new Date(now); ws.setDate(now.getDate() - now.getDay() + 1);
        const we  = new Date(ws);  we.setDate(ws.getDate() + 6);
        const weekStart = ws.toISOString().slice(0, 10);
        const weekEnd   = we.toISOString().slice(0, 10);

        const commAmt = parseFloat((order.total_amount * dealer.commission_rate / 100).toFixed(2));
        db.prepare(`
          INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
          VALUES (?,?,?,?,'direct','pending',?,?)
        `).run(dealer.id, order.id, commAmt, dealer.commission_rate, weekStart, weekEnd);

        if (dealer.tier === 2 && dealer.referred_by_id) {
          const parent    = db.prepare('SELECT * FROM users WHERE id=?').get(dealer.referred_by_id);
          const parentAmt = parseFloat((order.total_amount * parent.commission_rate / 100).toFixed(2));
          db.prepare(`
            INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
            VALUES (?,?,?,?,'override','pending',?,?)
          `).run(parent.id, order.id, parentAmt, parent.commission_rate, weekStart, weekEnd);
        }
      }
    }
  })();

  /* Notify linked dealer */
  if (order.linked_dealer_id) {
    try {
      createNotification(
        'dealer', order.linked_dealer_id,
        `Payment received — ${order.order_number}`,
        `Customer paid ₹${order.total_amount.toFixed(2)} for order ${order.order_number}. Ready to process.`,
        { order_id: order.id, order_number: order.order_number }
      );
    } catch { /* non-fatal */ }
  }

  /* Notify delivery dealer if different from linked dealer */
  if (order.delivery_dealer_id && order.delivery_dealer_id !== order.linked_dealer_id) {
    try {
      createNotification(
        'dealer', order.delivery_dealer_id,
        `Payment received — ${order.order_number}`,
        `Payment confirmed for order ${order.order_number}. Prepare for delivery.`,
        { order_id: order.id, order_number: order.order_number }
      );
    } catch { /* non-fatal */ }
  }

  res.json({ success: true });
});

module.exports = router;
