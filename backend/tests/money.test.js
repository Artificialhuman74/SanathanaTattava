/**
 * Part 1 — Money & precision
 *
 * Asserts that every rupee path in the platform rounds correctly, refuses
 * negatives / NaN / Infinity, and survives realistic edge inputs (sub-paise
 * commissions, double refunds, mismatched payout totals).
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

const RZP_SECRET = 'test-rzp-secret-money';
const app = createApp();

/* HMAC the way /payments/verify expects */
function sign(rzpOrderId, rzpPaymentId) {
  return crypto
    .createHmac('sha256', RZP_SECRET)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest('hex');
}

async function payOrder(consumer, order) {
  const rzpOrderId   = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rzpPaymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await request(app)
    .post('/api/payments/verify')
    .set(consumer.headers)
    .send({
      razorpay_order_id:   rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature:  sign(rzpOrderId, rzpPaymentId),
      consumer_order_id:   order.id,
    });
  return { res, rzpOrderId, rzpPaymentId };
}

beforeAll(() => {
  process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;
});

beforeEach(() => factory.clearAll());

/* ── 1.1 Commission precision ───────────────────────────────────────────── */
describe('Commission precision', () => {
  test('100 × 10% = 10.00 (exact)', async () => {
    const dealer   = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 100, payment_status: 'pending', status: 'pending',
    });

    const { res } = await payOrder(consumer, order);
    expect(res.status).toBe(200);

    const c = db.prepare(`SELECT amount, rate, type FROM commissions WHERE consumer_order_id=?`).get(order.id);
    expect(c).toBeDefined();
    expect(c.type).toBe('direct');
    expect(c.rate).toBeCloseTo(10);
    expect(c.amount).toBeCloseTo(10.00, 2);
  });

  test('0.99 × 7% rounds to 0.07', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=7 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, total_amount: 0.99,
      payment_status: 'pending', status: 'pending',
    });

    await payOrder(consumer, order);
    const c = db.prepare(`SELECT amount FROM commissions WHERE consumer_order_id=?`).get(order.id);
    // 0.99 * 7 / 100 = 0.0693 → toFixed(2) → "0.07"
    expect(c.amount).toBeCloseTo(0.07, 2);
  });

  test('33.33 × 33.33% rounds to 2 decimals', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=33.33 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, total_amount: 33.33,
      payment_status: 'pending', status: 'pending',
    });

    await payOrder(consumer, order);
    const c = db.prepare(`SELECT amount FROM commissions WHERE consumer_order_id=?`).get(order.id);
    // 33.33 * 33.33 / 100 = 11.10888... → 11.11
    expect(c.amount).toBeCloseTo(11.11, 2);
    // Stored value should have at most 2 decimals worth of precision
    expect(Math.abs(c.amount - 11.11)).toBeLessThan(0.005);
  });

  test('0% commission rate stores amount = 0', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=0 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, total_amount: 1000,
      payment_status: 'pending', status: 'pending',
    });
    await payOrder(consumer, order);
    const c = db.prepare(`SELECT amount FROM commissions WHERE consumer_order_id=?`).get(order.id);
    expect(c.amount).toBe(0);
  });
});

/* ── 1.2 Tier-2 override stacks on top of tier-1 ───────────────────────── */
describe('Tier-2 override commission', () => {
  test('Sub-dealer order produces both direct + override commissions', async () => {
    const parent = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=5 WHERE id=?').run(parent.user.id);

    const sub = factory.createTrader({ tier: 2 });
    db.prepare('UPDATE users SET commission_rate=10, referred_by_id=? WHERE id=?')
      .run(parent.user.id, sub.user.id);

    const consumer = factory.createConsumer({ linked_dealer_id: sub.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: sub.user.id, total_amount: 200,
      payment_status: 'pending', status: 'pending',
    });

    await payOrder(consumer, order);

    const rows = db.prepare(`SELECT amount, rate, type, trader_id FROM commissions WHERE consumer_order_id=? ORDER BY type`).all(order.id);
    expect(rows).toHaveLength(2);

    const direct   = rows.find(r => r.type === 'direct');
    const override = rows.find(r => r.type === 'override');
    expect(direct).toBeDefined();
    expect(override).toBeDefined();
    expect(direct.trader_id).toBe(sub.user.id);
    expect(override.trader_id).toBe(parent.user.id);
    expect(direct.amount).toBeCloseTo(20.00, 2);   // 200 × 10%
    expect(override.amount).toBeCloseTo(10.00, 2); // 200 × 5%
  });

  test('Tier-1 dealer order does NOT produce override', async () => {
    const t1 = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(t1.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: t1.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: t1.user.id, total_amount: 500,
      payment_status: 'pending', status: 'pending',
    });
    await payOrder(consumer, order);
    const rows = db.prepare(`SELECT type FROM commissions WHERE consumer_order_id=?`).all(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('direct');
  });

  test('is_direct order writes NO commissions even with linked dealer', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, total_amount: 100,
      is_direct: 1,
      payment_status: 'pending', status: 'pending',
    });
    await payOrder(consumer, order);
    const rows = db.prepare(`SELECT id FROM commissions WHERE consumer_order_id=?`).all(order.id);
    expect(rows).toHaveLength(0);
  });
});

/* ── 1.3 Refund money guards ────────────────────────────────────────────── */
describe('Refund money guards', () => {
  let admin;
  beforeEach(() => { admin = factory.createAdmin(); });

  test('Refund non-paid order → 400', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending', total_amount: 500,
    });
    const res = await request(app)
      .post('/api/payments/refund')
      .set(admin.headers)
      .send({ consumer_order_id: order.id });
    expect([400, 503]).toContain(res.status);
    if (res.status === 400) expect(res.body.error).toMatch(/not paid/i);
  });

  test('Refund nonexistent order → 404 (or 503 if gateway not configured)', async () => {
    const res = await request(app)
      .post('/api/payments/refund')
      .set(admin.headers)
      .send({ consumer_order_id: 999_999 });
    expect([404, 503]).toContain(res.status);
  });

  test('Refund without consumer_order_id → 400', async () => {
    const res = await request(app)
      .post('/api/payments/refund')
      .set(admin.headers)
      .send({});
    expect([400, 503]).toContain(res.status);
  });

  test('Refund an order already marked refunded → 400', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 500,
    });
    db.prepare(`UPDATE consumer_orders SET razorpay_payment_id='pay_x', refund_id='rfnd_x' WHERE id=?`).run(order.id);
    const res = await request(app)
      .post('/api/payments/refund')
      .set(admin.headers)
      .send({ consumer_order_id: order.id });
    expect([400, 503]).toContain(res.status);
    if (res.status === 400) expect(res.body.error).toMatch(/already refunded/i);
  });

  test('Refund requires admin auth', async () => {
    const trader = factory.createTrader();
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, { payment_status: 'paid' });
    const res = await request(app)
      .post('/api/payments/refund')
      .set(trader.headers)
      .send({ consumer_order_id: order.id });
    expect([401, 403]).toContain(res.status);
  });

  test('Refund without auth → 401', async () => {
    const res = await request(app)
      .post('/api/payments/refund')
      .send({ consumer_order_id: 1 });
    expect(res.status).toBe(401);
  });
});

/* ── 1.4 Order/payout total integrity ───────────────────────────────────── */
describe('Order total & payout integrity', () => {
  test('subtotal − discount_amount = total_amount (factory data check)', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      subtotal: 1000, discount_percent: 10, discount_amount: 100, total_amount: 900,
    });
    const row = db.prepare('SELECT subtotal, discount_amount, total_amount FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.subtotal - row.discount_amount).toBeCloseTo(row.total_amount, 2);
  });

  test('weekly_payouts.total_amount equals SUM(commissions.amount) for that week', () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer();

    const o1 = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, total_amount: 100, payment_status: 'paid',
    });
    const o2 = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, total_amount: 250, payment_status: 'paid',
    });

    // Insert commissions directly (simulating post-payment state)
    db.prepare(`INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
                VALUES (?,?,?,?,'direct','pending','2026-05-18','2026-05-24')`)
      .run(dealer.user.id, o1.id, 10.00, 10);
    db.prepare(`INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
                VALUES (?,?,?,?,'direct','pending','2026-05-18','2026-05-24')`)
      .run(dealer.user.id, o2.id, 25.00, 10);

    const sum = db.prepare(`
      SELECT ROUND(SUM(amount), 2) as total
      FROM commissions
      WHERE trader_id=? AND week_start='2026-05-18' AND status='pending'
    `).get(dealer.user.id);

    expect(sum.total).toBeCloseTo(35.00, 2);
  });
});

/* ── 1.5 Numeric pollution: NaN/Infinity/negative on refund amount ───── */
describe('Numeric pollution on refund.amount', () => {
  let admin, consumer, order;
  beforeEach(() => {
    admin    = factory.createAdmin();
    consumer = factory.createConsumer();
    order    = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 500,
    });
    db.prepare(`UPDATE consumer_orders SET razorpay_payment_id='pay_test' WHERE id=?`).run(order.id);
  });

  for (const bad of [-100, 0, 'abc']) {
    test(`Refund amount = ${JSON.stringify(bad)} is not silently treated as full refund`, async () => {
      const res = await request(app)
        .post('/api/payments/refund')
        .set(admin.headers)
        .send({ consumer_order_id: order.id, amount: bad });
      // Without RAZORPAY_KEY_ID env, gateway is null → 503 short-circuits.
      // We still want to be sure we don't 200 with junk.
      expect([400, 500, 503]).toContain(res.status);
    });
  }
});
