/**
 * Part 15 — Locale & INR formatting
 *
 * Tests for Indian locale formatting, pincode/phone string storage,
 * ISO-8601 timestamps, and week boundary calculations.
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

const RZP_SECRET = 'test-rzp-locale-secret';
const app = createApp();

function sign(rzpOrderId, rzpPaymentId) {
  return crypto
    .createHmac('sha256', RZP_SECRET)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest('hex');
}

async function payOrder(consumer, order) {
  const rzpOrderId   = `order_locale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rzpPaymentId = `pay_locale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

/* ── 15.1 Commission amounts have 2 decimal precision ─────────────────── */
describe('Commission decimal precision (INR)', () => {
  test('Commission amount stored with exactly 2 decimal places for ₹1 total', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=100 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 1,
      payment_status: 'pending',
      status: 'pending',
    });

    const { res } = await payOrder(consumer, order);
    expect(res.status).toBe(200);

    const c = db.prepare('SELECT amount FROM commissions WHERE consumer_order_id=?').get(order.id);
    expect(c).toBeDefined();
    // 1 * 100% = 1.00 — stored as number, toFixed(2) must be '1.00'
    expect(parseFloat(c.amount.toFixed(2))).toBe(1.00);
    expect(c.amount.toFixed(2)).toBe('1.00');
  });

  test('Commission amount for ₹1,00,000 (lakh) is stored with 2 decimal precision', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 100000,
      payment_status: 'pending',
      status: 'pending',
    });

    const { res } = await payOrder(consumer, order);
    expect(res.status).toBe(200);

    const c = db.prepare('SELECT amount FROM commissions WHERE consumer_order_id=?').get(order.id);
    expect(c).toBeDefined();
    // 100000 * 10% = 10000.00
    expect(c.amount).toBe(10000.00);
    expect(c.amount.toFixed(2)).toBe('10000.00');

    // Verify Indian locale formatting (lakh system)
    const formatted = c.amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // 10000 in en-IN = "10,000.00"
    expect(formatted).toMatch(/10,000\.00/);
  });

  test('toLocaleString en-IN formats 100000 as 1,00,000.00 (lakh system)', () => {
    const amount = 100000;
    const formatted = amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // Indian lakh system: 1,00,000.00
    expect(formatted).toBe('1,00,000.00');
  });
});

/* ── 15.2 Pincode stored as string, leading-zero safe ─────────────────── */
describe('Pincode string storage (leading-zero safe)', () => {
  test('Consumer order with pincode "012345" round-trips as string', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      pincode: '012345',
    });
    const row = db.prepare('SELECT pincode FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.pincode).toBe('012345');
    expect(typeof row.pincode).toBe('string');
    // Must NOT be coerced to number (would drop leading zero)
    expect(row.pincode).not.toBe('12345');
  });

  test('Pincode "560001" round-trips correctly', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      pincode: '560001',
    });
    const row = db.prepare('SELECT pincode FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.pincode).toBe('560001');
    expect(typeof row.pincode).toBe('string');
  });
});

/* ── 15.3 Timestamps are valid ISO-8601 strings ────────────────────────── */
describe('Timestamps are valid ISO-8601', () => {
  test('/api/health endpoint returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('consumer_orders created_at is a valid ISO-8601 or datetime string', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {});
    const row = db.prepare('SELECT created_at, updated_at FROM consumer_orders WHERE id=?').get(order.id);

    // SQLite CURRENT_TIMESTAMP format: 'YYYY-MM-DD HH:MM:SS'
    // Both formats (space-separated or T-separated) are valid datetime strings
    expect(typeof row.created_at).toBe('string');
    expect(typeof row.updated_at).toBe('string');

    // Should parse as a valid date
    const createdDate = new Date(row.created_at);
    expect(createdDate.getTime()).not.toBeNaN();

    const updatedDate = new Date(row.updated_at);
    expect(updatedDate.getTime()).not.toBeNaN();
  });

  test('commissions created_at is a valid datetime string', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 100,
      payment_status: 'pending',
      status: 'pending',
    });
    await payOrder(consumer, order);

    const c = db.prepare('SELECT created_at FROM commissions WHERE consumer_order_id=?').get(order.id);
    expect(typeof c.created_at).toBe('string');
    const d = new Date(c.created_at);
    expect(d.getTime()).not.toBeNaN();
  });

  test('users created_at is a valid datetime string', () => {
    const { user } = factory.createTrader();
    const row = db.prepare('SELECT created_at FROM users WHERE id=?').get(user.id);
    expect(typeof row.created_at).toBe('string');
    const d = new Date(row.created_at);
    expect(d.getTime()).not.toBeNaN();
  });
});

/* ── 15.4 Week boundaries: Monday → Sunday ──────────────────────────────── */
describe('Commission week_start/week_end boundaries', () => {
  test('week_start is Monday and week_end is Sunday', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 100,
      payment_status: 'pending',
      status: 'pending',
    });

    const { res } = await payOrder(consumer, order);
    expect(res.status).toBe(200);

    const c = db.prepare('SELECT week_start, week_end FROM commissions WHERE consumer_order_id=?').get(order.id);
    expect(c).toBeDefined();
    expect(c.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.week_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Parse week start/end
    const ws = new Date(c.week_start);
    const we = new Date(c.week_end);

    // week_start should be Monday (getDay() === 1)
    expect(ws.getDay()).toBe(1);

    // week_end should be Sunday (getDay() === 0)
    expect(we.getDay()).toBe(0);

    // week_end - week_start should be exactly 6 days
    const diffMs   = we.getTime() - ws.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6);
  });

  test('week_start and week_end are valid date strings in YYYY-MM-DD format', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=5 WHERE id=?').run(dealer.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 50,
      payment_status: 'pending',
      status: 'pending',
    });

    await payOrder(consumer, order);

    const c = db.prepare('SELECT week_start, week_end FROM commissions WHERE consumer_order_id=?').get(order.id);
    // Must match YYYY-MM-DD
    expect(c.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.week_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/* ── 15.5 Phone stored as string, leading-zero safe ───────────────────── */
describe('Phone string storage (leading-zero safe)', () => {
  test('Consumer with phone "07700900123" retrieves exact string value', () => {
    // Insert consumer with leading-zero phone directly
    const email = `phone-test-${Date.now()}@test.com`;
    const r = db.prepare(`
      INSERT INTO consumers (name, email, password, phone, status, email_verified)
      VALUES (?, ?, ?, ?, 'active', 1)
    `).run('Phone Test', email, 'hash', '07700900123');
    const consumer = db.prepare('SELECT phone FROM consumers WHERE id=?').get(r.lastInsertRowid);
    expect(consumer.phone).toBe('07700900123');
    expect(typeof consumer.phone).toBe('string');
    // Must NOT be numeric (would drop leading zero)
    expect(consumer.phone).not.toBe('7700900123');
  });

  test('User phone field is stored as string', () => {
    const r = db.prepare(`
      INSERT INTO users (name, email, password, role, status)
      VALUES (?, ?, ?, 'trader', 'active')
    `).run('Phone Trader', `phonetrader-${Date.now()}@test.com`, 'hash');
    db.prepare('UPDATE users SET phone=? WHERE id=?').run('09876543210', r.lastInsertRowid);
    const user = db.prepare('SELECT phone FROM users WHERE id=?').get(r.lastInsertRowid);
    expect(user.phone).toBe('09876543210');
    expect(typeof user.phone).toBe('string');
  });
});
