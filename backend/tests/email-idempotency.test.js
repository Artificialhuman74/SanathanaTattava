/**
 * Part 17 — Email idempotency tests
 *
 * Tests idempotency guards on payment verify and order status updates.
 * emailService IS mocked so we test HTTP behavior and DB state, not real emails.
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');
const emailService  = require('../src/services/emailService');

const RZP_SECRET = 'test-rzp-notify';
const app = createApp();

function sign(rzpOrderId, rzpPaymentId) {
  return crypto
    .createHmac('sha256', RZP_SECRET)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest('hex');
}

async function verifyPayment(consumer, order) {
  const rzpOrderId   = `order_idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rzpPaymentId = `pay_idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await request(app)
    .post('/api/payments/verify')
    .set(consumer.headers)
    .send({
      razorpay_order_id:   rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature:  sign(rzpOrderId, rzpPaymentId),
      consumer_order_id:   order.id,
    });
  return res;
}

beforeAll(() => {
  process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;
});

beforeEach(() => {
  factory.clearAll();
  jest.clearAllMocks();
});

/* ── Payment verify: first call marks order paid ─────────────────────── */
describe('POST /api/payments/verify — first call', () => {
  test('order transitions from pending → paid on first verify', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending',
      status: 'pending',
      total_amount: 200,
    });

    const res = await verifyPayment(consumer, order);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = db.prepare('SELECT payment_status, status FROM consumer_orders WHERE id=?').get(order.id);
    expect(updated.payment_status).toBe('paid');
    expect(updated.status).toBe('confirmed');
  });

  test('razorpay_order_id and razorpay_payment_id are stored after verify', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending',
      status: 'pending',
      total_amount: 150,
    });

    const rzpOrderId   = `order_stored_${Date.now()}`;
    const rzpPaymentId = `pay_stored_${Date.now()}`;
    const sig = sign(rzpOrderId, rzpPaymentId);

    await request(app)
      .post('/api/payments/verify')
      .set(consumer.headers)
      .send({
        razorpay_order_id:   rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        razorpay_signature:  sig,
        consumer_order_id:   order.id,
      });

    const updated = db.prepare(
      'SELECT razorpay_order_id, razorpay_payment_id FROM consumer_orders WHERE id=?'
    ).get(order.id);
    expect(updated.razorpay_order_id).toBe(rzpOrderId);
    expect(updated.razorpay_payment_id).toBe(rzpPaymentId);
  });
});

/* ── Payment verify: second call on already-paid order is no-op ─────── */
describe('POST /api/payments/verify — idempotency guard', () => {
  test('second verify on already-paid order returns 400 (already paid)', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending',
      status: 'pending',
      total_amount: 300,
    });

    // First payment — succeeds
    const res1 = await verifyPayment(consumer, order);
    expect(res1.status).toBe(200);

    // Second payment — should be rejected
    const res2 = await verifyPayment(consumer, order);
    expect([400, 404]).toContain(res2.status);
  });

  test('second verify does NOT change payment_status from paid', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending',
      status: 'pending',
      total_amount: 100,
    });

    // Pay once
    await verifyPayment(consumer, order);

    // Check state is paid
    const mid = db.prepare('SELECT payment_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(mid.payment_status).toBe('paid');

    // Pay again (should fail)
    await verifyPayment(consumer, order);

    // State should still be paid (not changed back or to 'failed')
    const final = db.prepare('SELECT payment_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(final.payment_status).toBe('paid');
  });

  test('verify with wrong signature returns 400', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending',
      total_amount: 100,
    });

    const res = await request(app)
      .post('/api/payments/verify')
      .set(consumer.headers)
      .send({
        razorpay_order_id:   'order_bad',
        razorpay_payment_id: 'pay_bad',
        razorpay_signature:  'invalid_signature_xxx',
        consumer_order_id:   order.id,
      });
    expect(res.status).toBe(400);
  });

  test('verify with missing fields returns 400', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending',
      total_amount: 100,
    });

    const res = await request(app)
      .post('/api/payments/verify')
      .set(consumer.headers)
      .send({ consumer_order_id: order.id });
    expect(res.status).toBe(400);
  });
});

/* ── Admin cancel idempotency ───────────────────────────────────────────── */
describe('PUT /api/admin/consumer-orders/:id/status — cancel idempotency', () => {
  test('cancelling an already-cancelled order is a no-op (returns 200 or is handled)', async () => {
    const admin    = factory.createAdmin();
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      status: 'pending',
      payment_status: 'paid',
      total_amount: 200,
    });

    // First cancel
    const res1 = await request(app)
      .put(`/api/admin/consumer-orders/${order.id}/status`)
      .set(admin.headers)
      .send({ status: 'cancelled' });
    expect(res1.status).toBe(200);

    // Verify cancelled
    const afterFirst = db.prepare('SELECT status FROM consumer_orders WHERE id=?').get(order.id);
    expect(afterFirst.status).toBe('cancelled');

    // Second cancel — state machine should either accept (idempotent) or reject (guard)
    const res2 = await request(app)
      .put(`/api/admin/consumer-orders/${order.id}/status`)
      .set(admin.headers)
      .send({ status: 'cancelled' });

    // Either 200 (idempotent) or 400 (state machine guard)
    expect([200, 400]).toContain(res2.status);

    // Status should still be cancelled
    const afterSecond = db.prepare('SELECT status FROM consumer_orders WHERE id=?').get(order.id);
    expect(afterSecond.status).toBe('cancelled');
  });

  test('admin status update requires admin auth', async () => {
    const trader   = factory.createTrader();
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      status: 'pending',
      payment_status: 'paid',
    });

    const res = await request(app)
      .put(`/api/admin/consumer-orders/${order.id}/status`)
      .set(trader.headers)
      .send({ status: 'cancelled' });
    expect([401, 403]).toContain(res.status);
  });

  test('emailService mock is in place (stubs are jest functions)', () => {
    expect(typeof emailService.sendOrderConfirmationEmail).toBe('function');
    expect(emailService.sendOrderConfirmationEmail.mock).toBeDefined();
  });
});

/* ── Email mock verification ────────────────────────────────────────────── */
describe('emailService mock stubs', () => {
  test('all email functions are jest mocks', () => {
    const fns = [
      'sendVerificationEmail',
      'sendPasswordResetEmail',
      'sendOrderConfirmationEmail',
      'sendDeliveryOtpEmail',
      'sendCommissionConfirmationEmail',
    ];
    for (const fn of fns) {
      expect(typeof emailService[fn]).toBe('function');
      expect(emailService[fn].mock).toBeDefined();
    }
  });

  test('email mocks return resolved promise with messageId', async () => {
    const result = await emailService.sendVerificationEmail('test@example.com', 'token');
    expect(result).toHaveProperty('messageId');
  });
});
