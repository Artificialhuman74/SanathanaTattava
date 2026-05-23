/**
 * Part 20 — Compliance & legal
 */
const request = require('supertest');
const { createApp } = require('./helpers/app');
const factory = require('./helpers/factory');
const db = require('../src/database/db');

let app;

beforeAll(() => {
  app = createApp();
  // Ensure audit_log table exists (created by auditLog middleware on import)
  require('../src/middleware/auditLog');
});

beforeEach(() => {
  factory.clearAll();
  // Clear audit log between tests
  try { db.prepare('DELETE FROM audit_log').run(); } catch { /* table may not exist yet */ }
});

describe('GET /api/consumer/me/export', () => {
  test('returns consumer, orders, and addresses for authenticated consumer', async () => {
    const { consumer, headers } = factory.createConsumer();
    const res = await request(app)
      .get('/api/consumer/me/export')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('consumer');
    expect(res.body).toHaveProperty('orders');
    expect(res.body).toHaveProperty('addresses');
  });

  test('consumer data does NOT include password field', async () => {
    const { headers } = factory.createConsumer();
    const res = await request(app)
      .get('/api/consumer/me/export')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.consumer).not.toHaveProperty('password');
  });

  test('orders array contains the consumer\'s orders', async () => {
    const { consumer, headers } = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.id, { status: 'pending' });

    const res = await request(app)
      .get('/api/consumer/me/export')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].id).toBe(order.id);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/consumer/me/export');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/consumer/me (soft-delete)', () => {
  test('soft-deletes: consumer status becomes deleted, name becomes [Deleted]', async () => {
    const { consumer, headers } = factory.createConsumer();
    const res = await request(app)
      .delete('/api/consumer/me')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = db.prepare('SELECT * FROM consumers WHERE id = ?').get(consumer.id);
    expect(updated.status).toBe('deleted');
    expect(updated.name).toBe('[Deleted]');
  });

  test('after soft-delete, the consumer\'s orders still exist in DB', async () => {
    const { consumer, headers } = factory.createConsumer();
    factory.createConsumerOrder(consumer.id, { status: 'delivered' });
    factory.createConsumerOrder(consumer.id, { status: 'pending' });

    await request(app)
      .delete('/api/consumer/me')
      .set(headers);

    const orders = db.prepare('SELECT * FROM consumer_orders WHERE consumer_id = ?').all(consumer.id);
    expect(orders).toHaveLength(2);
  });

  test('after soft-delete, GET /api/consumer/me/export returns 401', async () => {
    const { headers } = factory.createConsumer();

    // Delete account
    await request(app).delete('/api/consumer/me').set(headers);

    // Same token should now be rejected (status = deleted, not active)
    const res = await request(app)
      .get('/api/consumer/me/export')
      .set(headers);

    expect(res.status).toBe(401);
  });

  test('soft-delete sets phone to NULL', async () => {
    const { consumer, headers } = factory.createConsumer();
    await request(app).delete('/api/consumer/me').set(headers);

    const updated = db.prepare('SELECT * FROM consumers WHERE id = ?').get(consumer.id);
    expect(updated.phone).toBeNull();
  });
});

describe('Audit log', () => {
  test('POST /api/payments/payout-week with no data creates audit_log row with action=payout-week', async () => {
    const { headers } = factory.createAdmin();

    const res = await request(app)
      .post('/api/payments/payout-week')
      .set(headers)
      .send({ week_start: '2026-01-06' });

    // With no pending commissions, returns 200 with transferred:0
    expect(res.status).toBe(200);
    expect(res.body.transferred).toBe(0);

    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'payout-week'").get();
    expect(row).toBeDefined();
    expect(row.action).toBe('payout-week');
  });

  test('POST /api/payments/payout-week audit log captures admin_id', async () => {
    const { user: admin, headers } = factory.createAdmin();

    await request(app)
      .post('/api/payments/payout-week')
      .set(headers)
      .send({ week_start: '2026-01-06' });

    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'payout-week'").get();
    expect(row).toBeDefined();
    expect(row.admin_id).toBe(admin.id);
  });

  test('POST /api/payments/refund returns 503 when razorpay not configured (audit log not written for 503)', async () => {
    const { headers } = factory.createAdmin();

    const res = await request(app)
      .post('/api/payments/refund')
      .set(headers)
      .send({ consumer_order_id: 999 });

    // Razorpay not configured in test env → 503
    expect(res.status).toBe(503);

    // Audit log should NOT have a row (status >= 400)
    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'refund'").get();
    expect(row).toBeUndefined();
  });
});

describe('Health endpoint — no sensitive data', () => {
  test('GET /api/health does not include razorpay key in response', async () => {
    const res = await request(app).get('/api/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/razorpay/i);
    expect(body).not.toMatch(/RAZORPAY/);
  });
});
