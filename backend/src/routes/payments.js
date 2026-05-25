const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const db       = require('../database/db');
const {
  createNotification,
  notifyDealerDeliveryAssigned,
  notifyConsumerDeliveryAssigned,
  notifyLinkedDealerOrderRouted,
} = require('../services/notificationService');
const { returnOrderInventory } = require('../services/inventoryService');
const { emitOrderUpdate } = require('../websocket/socketServer');
const { authenticate, requireAdmin, requireTrader } = require('../middleware/auth');
const { auditLog } = require('../middleware/auditLog');
const { sendOrderConfirmedEmail } = require('../services/emailService');
const { sendOrderInvoice } = require('../services/invoiceService');

const router = express.Router();

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const idempotencyKey = (scope, id) =>
  crypto.createHash('sha256').update(`${scope}:${id}`).digest('hex').slice(0, 32);

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
    const rzpErr = err?.error || err;
    console.error('[razorpay] create-order error:', {
      statusCode:  err?.statusCode,
      code:        rzpErr?.code,
      description: rzpErr?.description,
      field:       rzpErr?.field,
      reason:      rzpErr?.reason,
      message:     err?.message,
      raw:         JSON.stringify(err),
    });
    res.status(500).json({ error: rzpErr?.description || 'Failed to create payment order' });
  }
});

/* ── POST /api/payments/verify ───────────────────────────────────────── */
router.post('/verify', authConsumer, async (req, res) => {
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

  /* Notify linked dealer — show only their commission, not the customer's payment amount */
  if (order.linked_dealer_id) {
    try {
      const comm = db.prepare(
        `SELECT amount FROM commissions WHERE consumer_order_id=? AND trader_id=? AND type='direct'`
      ).get(order.id, order.linked_dealer_id);
      const commStr = comm ? `₹${parseFloat(String(comm.amount)).toFixed(2)}` : null;
      createNotification(
        'dealer', order.linked_dealer_id,
        `New order confirmed — ${order.order_number}`,
        commStr
          ? `Order ${order.order_number} is confirmed. Your commission: ${commStr}.`
          : `Order ${order.order_number} is confirmed. Ready to process.`,
        { order_id: order.id, order_number: order.order_number }
      );
    } catch { /* non-fatal */ }
  }

  /* Notify delivery dealer if different from linked dealer */
  if (order.delivery_dealer_id && order.delivery_dealer_id !== order.linked_dealer_id) {
    try {
      createNotification(
        'dealer', order.delivery_dealer_id,
        `New order to deliver — ${order.order_number}`,
        `Order ${order.order_number} is confirmed. Prepare for delivery.`,
        { order_id: order.id, order_number: order.order_number }
      );
    } catch { /* non-fatal */ }
  }

  /* Delivery assignment notifications — deferred from order creation until payment confirmed */
  try {
    const consumer = db.prepare('SELECT id,name FROM consumers WHERE id=?').get(order.consumer_id);
    if (order.delivery_dealer_id) {
      const deliveryDealer = db.prepare('SELECT id,name,phone FROM users WHERE id=?').get(order.delivery_dealer_id);
      if (deliveryDealer) {
        notifyDealerDeliveryAssigned({
          dealerId:        deliveryDealer.id,
          dealerName:      deliveryDealer.name,
          orderNumber:     order.order_number,
          consumerName:    consumer?.name ?? 'Customer',
          deliveryAddress: order.delivery_address,
          distanceKm:      order.delivery_distance_km ?? 0,
        });
        notifyConsumerDeliveryAssigned({
          consumerId:  order.consumer_id,
          orderNumber: order.order_number,
          dealerName:  deliveryDealer.name,
          dealerPhone: deliveryDealer.phone,
        });
        if (order.linked_dealer_id && order.delivery_dealer_id !== order.linked_dealer_id) {
          const linkedDealer = db.prepare('SELECT id,name FROM users WHERE id=?').get(order.linked_dealer_id);
          if (linkedDealer) {
            notifyLinkedDealerOrderRouted({
              linkedDealerId:     linkedDealer.id,
              linkedDealerName:   linkedDealer.name,
              orderNumber:        order.order_number,
              consumerName:       consumer?.name ?? 'Customer',
              deliveryDealerId:   deliveryDealer.id,
              deliveryDealerName: deliveryDealer.name,
              distanceKm:         order.delivery_distance_km ?? 0,
            });
          }
        }
      }
    }
  } catch { /* non-fatal */ }

  /* Real-time: push confirmed order to all relevant traders + admin */
  try {
    emitOrderUpdate({
      orderId:          order.id,
      orderNumber:      order.order_number,
      status:           'confirmed',
      deliveryStatus:   order.delivery_status || null,
      consumerId:       order.consumer_id,
      linkedDealerId:   order.linked_dealer_id,
      deliveryDealerId: order.delivery_dealer_id,
      extra: { event: 'order_paid' },
    });
  } catch { /* non-fatal */ }

  /* Create Razorpay Invoice + send via SMS & email, then include link in confirmation email */
  let invoiceUrl = null;
  try {
    const invoice = await sendOrderInvoice(order.id);
    invoiceUrl = invoice?.short_url || null;
  } catch (err) {
    const rzpErr = err?.error || err;
    console.error('[invoice] post-payment create failed:', {
      statusCode:  err?.statusCode,
      code:        rzpErr?.code,
      description: rzpErr?.description,
      field:       rzpErr?.field,
      reason:      rzpErr?.reason,
      message:     err?.message,
      raw:         JSON.stringify(err),
    });
  }

  /* Email consumer: order confirmed (with invoice link if available) */
  try {
    const consumer = db.prepare('SELECT name, email FROM consumers WHERE id=?').get(order.consumer_id);
    if (consumer?.email) {
      sendOrderConfirmedEmail(consumer.email, consumer.name, order.order_number, invoiceUrl)
        .catch(err => console.error('[email] order-confirmed failed:', err.message));
    }
  } catch { /* non-fatal */ }

  res.json({ success: true });
});

/* ── POST /api/payments/webhook ──────────────────────────────────────────
 * Razorpay → us. Signature-verified safety net for payment.captured /
 * payment.failed / refund.processed events. Mounted with raw body parsing
 * in index.js so HMAC can be computed against the exact bytes Razorpay sent.
 */
router.post('/webhook', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook secret not configured' });

  const signature = req.headers['x-razorpay-signature'];
  const rawBody   = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  const expected  = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!signature || expected !== signature) {
    console.error('[webhook] signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: 'Bad JSON' }); }

  const eventId = req.headers['x-razorpay-event-id'] || `${event.event}_${event.created_at}_${event.payload?.payment?.entity?.id || ''}`;

  // Idempotency: ignore duplicate deliveries
  const seen = db.prepare('SELECT 1 FROM razorpay_webhook_events WHERE event_id = ?').get(eventId);
  if (seen) return res.json({ ok: true, duplicate: true });
  db.prepare('INSERT INTO razorpay_webhook_events (event_id, event_type, payload) VALUES (?, ?, ?)')
    .run(eventId, event.event, rawBody);

  try {
    switch (event.event) {
      case 'payment.captured': {
        const p = event.payload.payment.entity;
        const order = db.prepare('SELECT * FROM consumer_orders WHERE razorpay_order_id = ?').get(p.order_id);
        if (order && order.payment_status !== 'paid') {
          db.prepare(`UPDATE consumer_orders SET payment_status='paid', status='confirmed', razorpay_payment_id=? WHERE id=?`)
            .run(p.id, order.id);
          console.log(`[webhook] payment.captured → order ${order.order_number} marked paid (safety net)`);
        }
        break;
      }
      case 'payment.failed': {
        const p = event.payload.payment.entity;
        const order = db.prepare('SELECT * FROM consumer_orders WHERE razorpay_order_id = ?').get(p.order_id);
        if (order) {
          db.prepare(`UPDATE consumer_orders SET payment_status='failed' WHERE id=?`).run(order.id);
          try { returnOrderInventory(order.id); } // idempotent
          catch (e) { console.error('[webhook payment.failed] restore err:', e.message); }
          console.log(`[webhook] payment.failed → order ${order.order_number}`);
        }
        break;
      }
      case 'refund.processed':
      case 'refund.created': {
        const r = event.payload.refund.entity;
        const order = db.prepare('SELECT * FROM consumer_orders WHERE razorpay_payment_id = ?').get(r.payment_id);
        if (order) {
          db.prepare(`UPDATE consumer_orders SET refund_id=?, refund_status=?, refund_amount=? WHERE id=?`)
            .run(r.id, r.status, r.amount / 100, order.id);
        }
        break;
      }
      case 'transfer.processed':
      case 'transfer.failed': {
        const t = event.payload.transfer.entity;
        const status = event.event === 'transfer.processed' ? 'transferred' : 'transfer_failed';
        db.prepare(`UPDATE commissions SET status=? WHERE razorpay_transfer_id=?`).run(status, t.id);
        break;
      }
      case 'invoice.paid': {
        const inv = event.payload.invoice.entity;
        const order = db.prepare('SELECT * FROM consumer_orders WHERE razorpay_invoice_id = ?').get(inv.id);
        if (!order) { console.log(`[webhook] invoice.paid — no order for invoice ${inv.id}`); break; }

        db.prepare(`UPDATE consumer_orders SET razorpay_invoice_status = 'paid' WHERE id = ?`).run(order.id);

        if (order.payment_status === 'paid') break; // already paid via web checkout

        /* Mark paid + record commissions (same as /verify) */
        db.transaction(() => {
          db.prepare(`
            UPDATE consumer_orders
            SET payment_status='paid', status='confirmed', razorpay_payment_id=?
            WHERE id=?
          `).run(inv.payment_id || null, order.id);

          if (!order.is_direct && order.linked_dealer_id) {
            const dealer = db.prepare('SELECT * FROM users WHERE id=?').get(order.linked_dealer_id);
            if (dealer) {
              const now = new Date();
              const ws  = new Date(now); ws.setDate(now.getDate() - now.getDay() + 1);
              const we  = new Date(ws);  we.setDate(ws.getDate() + 6);
              const commAmt = parseFloat((order.total_amount * dealer.commission_rate / 100).toFixed(2));
              db.prepare(`
                INSERT OR IGNORE INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
                VALUES (?,?,?,?,'direct','pending',?,?)
              `).run(dealer.id, order.id, commAmt, dealer.commission_rate, ws.toISOString().slice(0,10), we.toISOString().slice(0,10));
              if (dealer.tier === 2 && dealer.referred_by_id) {
                const parent    = db.prepare('SELECT * FROM users WHERE id=?').get(dealer.referred_by_id);
                const parentAmt = parseFloat((order.total_amount * parent.commission_rate / 100).toFixed(2));
                db.prepare(`
                  INSERT OR IGNORE INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
                  VALUES (?,?,?,?,'override','pending',?,?)
                `).run(parent.id, order.id, parentAmt, parent.commission_rate, ws.toISOString().slice(0,10), we.toISOString().slice(0,10));
              }
            }
          }
        })();

        /* Notifications */
        try { emitOrderUpdate({ orderId: order.id, orderNumber: order.order_number, status: 'confirmed', consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id, deliveryDealerId: order.delivery_dealer_id, extra: { event: 'order_paid' } }); } catch {}
        try {
          const c = db.prepare('SELECT name,email FROM consumers WHERE id=?').get(order.consumer_id);
          if (c?.email) sendOrderConfirmedEmail(c.email, c.name, order.order_number).catch(() => {});
        } catch {}
        console.log(`[webhook] invoice.paid → order ${order.order_number} marked paid`);
        break;
      }
      case 'invoice.expired': {
        const inv = event.payload.invoice.entity;
        db.prepare(`UPDATE consumer_orders SET razorpay_invoice_status = 'expired' WHERE razorpay_invoice_id = ?`).run(inv.id);
        console.log(`[webhook] invoice.expired → ${inv.id}`);
        break;
      }
      case 'account.activated':
      case 'account.under_review':
      case 'account.rejected': {
        const acct = event.payload.account?.entity;
        if (acct?.id) {
          const statusMap = {
            'account.activated':    'activated',
            'account.under_review': 'under_review',
            'account.rejected':     'rejected',
          };
          db.prepare(`UPDATE users SET razorpay_account_status=? WHERE razorpay_linked_account_id=?`)
            .run(statusMap[event.event], acct.id);
          console.log(`[webhook] ${event.event} → account ${acct.id}`);
        }
        break;
      }
      default:
        console.log(`[webhook] unhandled event: ${event.event}`);
    }
  } catch (err) {
    console.error('[webhook] handler error:', err.message);
  }

  // Always 200 once verified+stored — Razorpay retries non-2xx
  res.json({ ok: true });
});

/* ── POST /api/payments/refund (admin) ───────────────────────────────────
 * Refund a captured payment in full or part. Stores refund_id for
 * webhook reconciliation.
 */
router.post('/refund', authenticate, requireAdmin, auditLog('refund'), async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { consumer_order_id, amount, reason } = req.body;
  if (!consumer_order_id) return res.status(400).json({ error: 'consumer_order_id required' });

  const order = db.prepare('SELECT * FROM consumer_orders WHERE id=?').get(consumer_order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment_status !== 'paid' || !order.razorpay_payment_id)
    return res.status(400).json({ error: 'Order is not paid' });
  if (order.refund_id) return res.status(400).json({ error: 'Order already refunded' });

  const refundAmt = amount ? Math.round(amount * 100) : Math.round(order.total_amount * 100);

  try {
    const refund = await razorpay.payments.refund(order.razorpay_payment_id, {
      amount: refundAmt,
      notes:  { reason: reason || 'admin_initiated', order_number: order.order_number, idempotency_key: idempotencyKey('refund', order.id) },
    });

    db.prepare(`UPDATE consumer_orders SET refund_id=?, refund_status=?, refund_amount=?, status='cancelled' WHERE id=?`)
      .run(refund.id, refund.status, refund.amount / 100, order.id);

    // Restore dealer inventory (idempotent — no-op if already restored)
    try { returnOrderInventory(order.id); }
    catch (e) { console.error('[refund] inventory restore failed:', e.message); }

    // Reverse any pending commissions tied to this order
    db.prepare(`UPDATE commissions SET status='reversed' WHERE consumer_order_id=? AND status='pending'`).run(order.id);

    res.json({ success: true, refund_id: refund.id, status: refund.status, amount: refund.amount / 100 });
  } catch (err) {
    console.error('[razorpay] refund error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Refund failed' });
  }
});

/* ── POST /api/payments/onboard (admin) ──────────────────────────────────
 * All-in-one: create linked account + register Route product + bank details
 * + stakeholder KYC in a single call. Idempotent — skips steps already done.
 */
router.post('/onboard', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { trader_id } = req.body;
  if (!trader_id) return res.status(400).json({ error: 'trader_id required' });

  const trader = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(trader_id, 'trader');
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  if (!trader.bank_account_number || !trader.bank_ifsc || !trader.bank_account_name)
    return res.status(400).json({ error: 'Trader bank details missing — ask trader to fill bank details first' });
  if (!trader.pan)
    return res.status(400).json({ error: 'Trader PAN missing — required for KYC' });

  const steps = [];
  try {
    // Step 1: Create linked account (skip if already exists)
    let accountId = trader.razorpay_linked_account_id;
    if (!accountId) {
      const account = await razorpay.accounts.create({
        email:               trader.email,
        phone:               trader.phone,
        type:                'route',
        legal_business_name: trader.bank_account_name || trader.name,
        business_type:       'individual',
        contact_name:        trader.name,
        profile: {
          category:    'others',
          subcategory: 'others',
          addresses: {
            registered: {
              street1:     trader.address || 'NA',
              street2:     'NA',
              city:        'NA',
              state:       'KARNATAKA',
              postal_code: trader.pincode || '560001',
              country:     'IN',
            },
          },
        },
        legal_info: {},
      });
      accountId = account.id;
      db.prepare(`UPDATE users SET razorpay_linked_account_id=?, razorpay_account_status='created' WHERE id=?`)
        .run(accountId, trader.id);
      steps.push('linked_account_created');
    } else {
      steps.push('linked_account_exists');
    }

    // Step 2: Register Route product + bank details (skip if already done).
    // Gate on razorpay_product_id presence — if Razorpay already has the product
    // config, never re-submit (re-submission resets their review to needs_clarification).
    const status = db.prepare('SELECT razorpay_account_status, razorpay_product_id FROM users WHERE id=?').get(trader.id);
    if (!status.razorpay_product_id) {
      const product = await razorpay.products.requestProductConfiguration(accountId, {
        product_name: 'route',
        tnc_accepted: true,
      });
      await razorpay.products.edit(accountId, product.id, {
        settlements: {
          account_number:   trader.bank_account_number,
          ifsc_code:        trader.bank_ifsc,
          beneficiary_name: trader.bank_account_name,
        },
        tnc_accepted: true,
      });
      db.prepare(`UPDATE users SET razorpay_account_status='bank_added', razorpay_product_id=? WHERE id=?`)
        .run(product.id, trader.id);
      steps.push('bank_registered');
    } else {
      steps.push('bank_already_registered');
    }

    // Step 3: Add stakeholder for KYC (skip if already done)
    const status2 = db.prepare('SELECT razorpay_account_status FROM users WHERE id=?').get(trader.id);
    if (!['stakeholder_added', 'activated'].includes(status2.razorpay_account_status)) {
      try {
        const stakeholder = await razorpay.stakeholders.create(accountId, {
          name:                 trader.name,
          email:                trader.email,
          percentage_ownership: 100,
          relationship:         { director: true },
          phone:                { primary: trader.phone || '' },
          addresses: {
            residential: {
              street:      trader.address || 'NA',
              city:        'NA',
              state:       'Karnataka',
              postal_code: trader.pincode || '560001',
              country:     'IN',
            },
          },
          kyc: { pan: trader.pan },
        });
        db.prepare(`UPDATE users SET razorpay_account_status='stakeholder_added' WHERE id=?`).run(trader.id);
        steps.push(`stakeholder_created:${stakeholder.id}`);
      } catch (skErr) {
        const desc = skErr?.error?.description || skErr?.message || '';
        if (/already exists/i.test(desc)) {
          db.prepare(`UPDATE users SET razorpay_account_status='stakeholder_added' WHERE id=?`).run(trader.id);
          steps.push('stakeholder_already_exists_on_razorpay');
        } else {
          throw skErr;
        }
      }
    } else {
      steps.push('stakeholder_already_added');
    }

    res.json({ success: true, linked_account_id: accountId, steps });
  } catch (err) {
    console.error('[razorpay] onboard error:', err.error?.description || err.message, '| steps so far:', steps);
    res.status(500).json({ error: err.error?.description || err.message || 'Onboarding failed', steps });
  }
});

/* ── POST /api/payments/sync-account (admin) ─────────────────────────────
 * Manually pull the current account status from Razorpay and update DB.
 * Useful when the account.activated webhook was missed.
 */
router.post('/sync-account', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { trader_id } = req.body;
  if (!trader_id) return res.status(400).json({ error: 'trader_id required' });

  const trader = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(trader_id, 'trader');
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  if (!trader.razorpay_linked_account_id)
    return res.status(400).json({ error: 'No linked account — run onboarding first' });

  try {
    // account.status is always "created" — real activation lives on the product config
    // If we have the product ID, fetch it directly; otherwise list all products for the account
    let activationStatus;
    if (trader.razorpay_product_id) {
      const product = await razorpay.products.fetch(
        trader.razorpay_linked_account_id,
        trader.razorpay_product_id,
      );
      console.log('[sync-account] product fetch:', JSON.stringify(product));
      activationStatus = product.activation_status;
    } else {
      // No stored product_id — call the list endpoint directly
      const authHeader = 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const resp = await fetch(
        `https://api.razorpay.com/v2/accounts/${trader.razorpay_linked_account_id}/products`,
        { headers: { Authorization: authHeader } },
      );
      const data = await resp.json();
      console.log('[sync-account] products list:', JSON.stringify(data));
      const routeProduct = (data.items || []).find(p => p.product_name === 'route');
      if (routeProduct) {
        activationStatus = routeProduct.activation_status;
        // Save for future use
        db.prepare('UPDATE users SET razorpay_product_id=? WHERE id=?').run(routeProduct.id, trader.id);
      }
    }

    const mapped = activationStatus === 'activated'          ? 'activated'
                 : activationStatus === 'under_review'        ? 'under_review'
                 : activationStatus === 'needs_clarification' ? 'needs_clarification'
                 : activationStatus === 'suspended'           ? 'suspended'
                 : trader.razorpay_account_status;

    db.prepare('UPDATE users SET razorpay_account_status=? WHERE id=?').run(mapped, trader.id);
    res.json({ success: true, activation_status: activationStatus, mapped_status: mapped });
  } catch (err) {
    console.error('[razorpay] sync-account error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Failed to sync account status' });
  }
});

/* ── POST /api/payments/linked-account (admin) ───────────────────────────
 * Register a trader as a Razorpay Route linked account. Requires Route
 * to be activated on the merchant account; bank account is penny-tested
 * by Razorpay before transfers are allowed.
 */
router.post('/linked-account', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { trader_id } = req.body;
  if (!trader_id) return res.status(400).json({ error: 'trader_id required' });

  const trader = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(trader_id, 'trader');
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  if (trader.razorpay_linked_account_id)
    return res.status(400).json({ error: 'Trader already has a linked account', id: trader.razorpay_linked_account_id });
  if (!trader.bank_account_number || !trader.bank_ifsc || !trader.bank_account_name)
    return res.status(400).json({ error: 'Trader bank details missing — ask trader to fill bank details first' });

  try {
    // Razorpay Route Linked Account API (v2 accounts endpoint)
    const account = await razorpay.accounts.create({
      email:               trader.email,
      phone:               trader.phone,
      legal_business_name: trader.bank_account_name || trader.name,
      business_type:       'individual',
      contact_name:        trader.name,
      profile: {
        category:    'others',
        subcategory: 'others',
        addresses: {
          registered: {
            street1:     trader.address || 'NA',
            street2:     'NA',
            city:        'NA',
            state:       'KARNATAKA',
            postal_code: trader.pincode || '560001',
            country:     'IN',
          },
        },
      },
    });

    db.prepare(`UPDATE users SET razorpay_linked_account_id=?, razorpay_account_status=? WHERE id=?`)
      .run(account.id, account.status || 'created', trader.id);

    res.json({ success: true, linked_account_id: account.id, status: account.status });
  } catch (err) {
    console.error('[razorpay] linked-account error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Linked account creation failed' });
  }
});

/* ── POST /api/payments/add-bank-account (admin) ────────────────────────
 * Upload the trader's locally-stored bank details to their Razorpay linked
 * account. Must be called after /linked-account and before any transfers.
 */
router.post('/add-bank-account', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { trader_id } = req.body;
  if (!trader_id) return res.status(400).json({ error: 'trader_id required' });

  const trader = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(trader_id, 'trader');
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  if (!trader.razorpay_linked_account_id)
    return res.status(400).json({ error: 'Trader has no linked account — call /linked-account first' });
  if (!trader.bank_account_number || !trader.bank_ifsc || !trader.bank_account_name)
    return res.status(400).json({ error: 'Trader bank details missing' });

  try {
    // Step 1: Request the Route product — only product_name + tnc_accepted allowed here
    const product = await razorpay.products.requestProductConfiguration(
      trader.razorpay_linked_account_id,
      { product_name: 'route', tnc_accepted: true },
    );

    // Step 2: PATCH the product to add settlement (bank account) details
    const updated = await razorpay.products.edit(
      trader.razorpay_linked_account_id,
      product.id,
      {
        settlements: {
          account_number:   trader.bank_account_number,
          ifsc_code:        trader.bank_ifsc,
          beneficiary_name: trader.bank_account_name,
        },
        tnc_accepted: true,
      },
    );

    db.prepare(`UPDATE users SET razorpay_account_status='bank_added', razorpay_product_id=? WHERE id=?`)
      .run(product.id, trader.id);

    res.json({ success: true, product_id: product.id, activation_status: updated.activation_status, requirements: updated.requirements });
  } catch (err) {
    console.error('[razorpay] add-bank-account error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Failed to add bank account' });
  }
});

/* ── POST /api/payments/stakeholder (admin) ──────────────────────────────
 * Add the trader as a stakeholder (KYC owner) on their linked account.
 * Razorpay requires this before the account can be activated.
 */
router.post('/stakeholder', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { trader_id } = req.body;
  if (!trader_id) return res.status(400).json({ error: 'trader_id required' });

  const trader = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(trader_id, 'trader');
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  if (!trader.razorpay_linked_account_id)
    return res.status(400).json({ error: 'Trader has no linked account — call /linked-account first' });

  try {
    const stakeholder = await razorpay.stakeholders.create(
      trader.razorpay_linked_account_id,
      {
        name:                 trader.name,
        email:                trader.email,
        percentage_ownership: 100,
        relationship:         { director: true },
        phone:                { primary: trader.phone || '' },
        addresses: {
          residential: {
            street:      trader.address || 'NA',
            city:        'NA',
            state:       'Karnataka',
            postal_code: trader.pincode || '560001',
            country:     'IN',
          },
        },
        kyc: { pan: trader.pan || '' },
      },
    );

    db.prepare(`UPDATE users SET razorpay_account_status='stakeholder_added' WHERE id=?`).run(trader.id);

    res.json({ success: true, stakeholder_id: stakeholder.id });
  } catch (err) {
    console.error('[razorpay] stakeholder error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Failed to add stakeholder' });
  }
});

/* ── POST /api/payments/sync-transfer (admin) ────────────────────────────
 * Pull the current transfer status from Razorpay and update the commission.
 * Useful when the transfer.processed/failed webhook was missed.
 */
router.post('/sync-transfer', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { commission_id } = req.body;
  if (!commission_id) return res.status(400).json({ error: 'commission_id required' });

  const comm = db.prepare('SELECT * FROM commissions WHERE id=?').get(commission_id);
  if (!comm) return res.status(404).json({ error: 'Commission not found' });
  if (!comm.razorpay_transfer_id) return res.status(400).json({ error: 'No transfer ID — transfer has not been initiated yet' });

  try {
    const transfer = await razorpay.transfers.fetch(comm.razorpay_transfer_id);
    console.log('[sync-transfer] transfer status:', transfer.status, 'for', comm.razorpay_transfer_id);

    const mapped =
      transfer.status === 'processed' ? 'transferred' :
      transfer.status === 'failed'    ? 'transfer_failed' :
      comm.status; // no change for 'created' or unknown

    db.prepare('UPDATE commissions SET status=? WHERE id=?').run(mapped, comm.id);
    res.json({ success: true, razorpay_status: transfer.status, mapped_status: mapped });
  } catch (err) {
    console.error('[razorpay] sync-transfer error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Failed to sync transfer status' });
  }
});

/* ── POST /api/payments/sync-transfer/me (trader) ────────────────────────
 * Trader syncs their own commission transfer status from Razorpay.
 */
router.post('/sync-transfer/me', authenticate, requireTrader, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { commission_id } = req.body;
  if (!commission_id) return res.status(400).json({ error: 'commission_id required' });

  const comm = db.prepare('SELECT * FROM commissions WHERE id=? AND trader_id=?').get(commission_id, req.user.id);
  if (!comm) return res.status(404).json({ error: 'Commission not found' });
  if (!comm.razorpay_transfer_id) return res.status(400).json({ error: 'Transfer not yet initiated' });

  try {
    const transfer = await razorpay.transfers.fetch(comm.razorpay_transfer_id);
    const mapped =
      transfer.status === 'processed' ? 'transferred' :
      transfer.status === 'failed'    ? 'transfer_failed' :
      comm.status;
    db.prepare('UPDATE commissions SET status=? WHERE id=?').run(mapped, comm.id);
    res.json({ success: true, razorpay_status: transfer.status, mapped_status: mapped });
  } catch (err) {
    console.error('[razorpay] sync-transfer/me error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Failed to sync transfer' });
  }
});

/* ── POST /api/payments/transfer (admin) ─────────────────────────────────
 * Trigger a Route transfer for a single pending commission. The captured
 * consumer payment funds the source; the linked account receives the cut.
 */
router.post('/transfer', authenticate, requireAdmin, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });
  const { commission_id } = req.body;
  if (!commission_id) return res.status(400).json({ error: 'commission_id required' });

  const comm = db.prepare(`
    SELECT c.*, u.razorpay_linked_account_id, co.razorpay_payment_id, co.order_number
    FROM commissions c
    JOIN users u ON u.id = c.trader_id
    JOIN consumer_orders co ON co.id = c.consumer_order_id
    WHERE c.id = ?
  `).get(commission_id);

  if (!comm) return res.status(404).json({ error: 'Commission not found' });
  if (comm.status !== 'pending') return res.status(400).json({ error: `Commission is ${comm.status}, not pending` });
  if (comm.razorpay_transfer_id) return res.status(400).json({ error: 'Already transferred' });
  if (!comm.razorpay_linked_account_id) return res.status(400).json({ error: 'Trader has no linked account' });
  if (!comm.razorpay_payment_id) return res.status(400).json({ error: 'Source payment not captured' });

  try {
    const transfer = await razorpay.payments.transfer(comm.razorpay_payment_id, {
      transfers: [{
        account:  comm.razorpay_linked_account_id,
        amount:   Math.round(comm.amount * 100),
        currency: 'INR',
        notes:    { commission_id: String(comm.id), order_number: comm.order_number, idempotency_key: idempotencyKey('transfer', comm.id) },
      }],
    });

    const transferId = transfer.items?.[0]?.id || transfer.id;
    db.prepare(`UPDATE commissions SET razorpay_transfer_id=?, status='transferring' WHERE id=?`)
      .run(transferId, comm.id);

    res.json({ success: true, transfer_id: transferId });
  } catch (err) {
    console.error('[razorpay] transfer error:', err.error?.description || err.message);
    res.status(500).json({ error: err.error?.description || 'Transfer failed' });
  }
});

/* ── POST /api/payments/pay-all (admin) ──────────────────────────────────
 * Pay every pending commission whose trader has an activated Route account.
 * No week filter — clears the full backlog in one call.
 */
router.post('/pay-all', authenticate, requireAdmin, auditLog('pay-all'), async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });

  const pending = db.prepare(`
    SELECT c.*, u.razorpay_linked_account_id, u.razorpay_account_status, u.name AS trader_name,
           co.razorpay_payment_id, co.order_number
    FROM commissions c
    JOIN users u  ON u.id  = c.trader_id
    JOIN consumer_orders co ON co.id = c.consumer_order_id
    WHERE c.status = 'pending'
      AND c.razorpay_transfer_id IS NULL
  `).all();

  if (pending.length === 0)
    return res.json({ transferred: 0, skipped: 0, errors: [], message: 'No pending commissions' });

  let transferred = 0, skipped = 0;
  const errors = [];

  for (const comm of pending) {
    if (!comm.razorpay_linked_account_id || comm.razorpay_account_status !== 'activated' || !comm.razorpay_payment_id) {
      skipped++;
      continue;
    }
    try {
      const transfer = await razorpay.payments.transfer(comm.razorpay_payment_id, {
        transfers: [{
          account:  comm.razorpay_linked_account_id,
          amount:   Math.round(comm.amount * 100),
          currency: 'INR',
          notes:    { commission_id: String(comm.id), order_number: comm.order_number, idempotency_key: idempotencyKey('transfer', comm.id) },
        }],
      });

      const transferId = transfer.items?.[0]?.id || transfer.id;
      db.prepare(`UPDATE commissions SET razorpay_transfer_id=?, status='transferring' WHERE id=?`)
        .run(transferId, comm.id);
      transferred++;
    } catch (err) {
      const msg = err.error?.description || err.message;
      console.error(`[pay-all] commission ${comm.id} failed: ${msg}`);
      errors.push({ commission_id: comm.id, trader: comm.trader_name, error: msg });
    }
  }

  res.json({ transferred, skipped, errors, total: pending.length });
});

/* ── POST /api/payments/payout-week (admin) ──────────────────────────────
 * Batch-transfer all pending commissions for a given week whose traders
 * have an activated Route account.
 *
 * body: { week_start: 'YYYY-MM-DD' }
 *
 * Returns: { transferred, skipped, errors }
 *   transferred — commissions successfully sent to Razorpay
 *   skipped     — commissions whose trader has no linked/activated account
 *   errors      — per-commission failures (transfer attempted but Razorpay rejected)
 */
router.post('/payout-week', authenticate, requireAdmin, auditLog('payout-week'), async (req, res) => {
  const { week_start } = req.body;
  if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start))
    return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });

  const pending = db.prepare(`
    SELECT c.*, u.razorpay_linked_account_id, u.razorpay_account_status, u.name AS trader_name,
           co.razorpay_payment_id, co.order_number
    FROM commissions c
    JOIN users u  ON u.id  = c.trader_id
    JOIN consumer_orders co ON co.id = c.consumer_order_id
    WHERE c.week_start = ?
      AND c.status     = 'pending'
      AND c.razorpay_transfer_id IS NULL
  `).all(week_start);

  if (pending.length === 0)
    return res.json({ transferred: 0, skipped: 0, errors: [], message: 'No pending commissions for this week' });

  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });

  let transferred = 0;
  let skipped = 0;
  const errors = [];

  for (const comm of pending) {
    // Skip if trader not activated on Route
    if (!comm.razorpay_linked_account_id || comm.razorpay_account_status !== 'activated') {
      skipped++;
      continue;
    }
    if (!comm.razorpay_payment_id) {
      skipped++;
      continue;
    }

    try {
      const transfer = await razorpay.payments.transfer(comm.razorpay_payment_id, {
        transfers: [{
          account:  comm.razorpay_linked_account_id,
          amount:   Math.round(comm.amount * 100),
          currency: 'INR',
          notes:    { commission_id: String(comm.id), order_number: comm.order_number, idempotency_key: idempotencyKey('transfer', comm.id) },
        }],
      });

      const transferId = transfer.items?.[0]?.id || transfer.id;
      db.prepare(`UPDATE commissions SET razorpay_transfer_id=?, status='transferring' WHERE id=?`)
        .run(transferId, comm.id);
      transferred++;
    } catch (err) {
      const msg = err.error?.description || err.message;
      console.error(`[payout-week] commission ${comm.id} failed: ${msg}`);
      errors.push({ commission_id: comm.id, trader: comm.trader_name, error: msg });
    }
  }

  res.json({ transferred, skipped, errors, total: pending.length });
});

/* ── POST /api/payments/bank-details (trader) ────────────────────────────
 * Trader self-service: save bank details for Route payouts. Stored
 * locally; admin then creates the linked account.
 */
router.post('/bank-details', authenticate, requireTrader, (req, res) => {
  const { bank_account_name, bank_account_number, bank_ifsc, pan } = req.body;
  if (!bank_account_name || !bank_account_number || !bank_ifsc)
    return res.status(400).json({ error: 'All bank fields required' });
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank_ifsc))
    return res.status(400).json({ error: 'Invalid IFSC code' });
  if (!/^\d{9,18}$/.test(bank_account_number))
    return res.status(400).json({ error: 'Invalid account number' });
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase()))
    return res.status(400).json({ error: 'Invalid PAN format (e.g. ABCDE1234F)' });

  db.prepare(`UPDATE users SET bank_account_name=?, bank_account_number=?, bank_ifsc=?, pan=? WHERE id=?`)
    .run(bank_account_name.trim(), bank_account_number.trim(), bank_ifsc.toUpperCase().trim(), pan ? pan.trim().toUpperCase() : null, req.user.id);

  res.json({ success: true });
});

module.exports = router;
