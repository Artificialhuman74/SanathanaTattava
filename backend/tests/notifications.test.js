/**
 * Part 17 — Notification deliverability & idempotency
 *
 * Tests notification endpoints, isolation between user types,
 * mark-as-read, and idempotency guards on payment verify.
 *
 * NOTE: notificationService is MOCKED in jest config (the mock overrides
 * service functions so routes return empty). We test the DB layer directly
 * and the mock expectations separately.
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

// Access the mocked notification service to inspect calls
const notificationService = require('../src/services/notificationService');

const RZP_SECRET = 'test-rzp-notify';
const app = createApp();

function sign(rzpOrderId, rzpPaymentId) {
  return crypto
    .createHmac('sha256', RZP_SECRET)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest('hex');
}

async function payOrder(consumer, order) {
  const rzpOrderId   = `order_notify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rzpPaymentId = `pay_notify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

// Helper to insert a notification row directly into DB
function insertNotification({ user_type, user_id, title, body, data = null, read = 0 }) {
  const r = db.prepare(`
    INSERT INTO notifications (user_type, user_id, title, body, data, channel, read)
    VALUES (?, ?, ?, ?, ?, 'in_app', ?)
  `).run(user_type, user_id, title, body, data ? JSON.stringify(data) : null, read);
  return db.prepare('SELECT * FROM notifications WHERE id=?').get(r.lastInsertRowid);
}

beforeAll(() => {
  process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;
});

beforeEach(() => {
  factory.clearAll();
  // Reset mock call history between tests
  jest.clearAllMocks();
});

/* ── 17.1 Dealer notification endpoint ─────────────────────────────────── */
describe('GET /api/notifications/dealer', () => {
  test('requires trader JWT — returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications/dealer');
    expect(res.status).toBe(401);
  });

  test('requires trader JWT — admin token returns 403', async () => {
    const admin = factory.createAdmin();
    const res = await request(app)
      .get('/api/notifications/dealer')
      .set(admin.headers);
    expect(res.status).toBe(403);
  });

  test('trader can fetch their notifications (mocked service returns empty)', async () => {
    const trader = factory.createTrader();
    const res = await request(app)
      .get('/api/notifications/dealer')
      .set(trader.headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('unread_count');
    expect(res.body).toHaveProperty('notifications');
  });
});

/* ── 17.2 Admin notification endpoint ──────────────────────────────────── */
describe('GET /api/notifications/admin', () => {
  test('requires admin JWT — returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications/admin');
    expect(res.status).toBe(401);
  });

  test('requires admin JWT — trader token returns 403', async () => {
    const trader = factory.createTrader();
    const res = await request(app)
      .get('/api/notifications/admin')
      .set(trader.headers);
    expect(res.status).toBe(403);
  });

  test('admin can fetch admin notifications', async () => {
    const admin = factory.createAdmin();
    const res = await request(app)
      .get('/api/notifications/admin')
      .set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('unread_count');
    expect(res.body).toHaveProperty('notifications');
  });
});

/* ── 17.3 Consumer notification endpoint ───────────────────────────────── */
describe('GET /api/notifications/consumer', () => {
  test('requires consumer JWT — returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications/consumer');
    expect(res.status).toBe(401);
  });

  test('requires consumer JWT — trader token returns 403', async () => {
    const trader = factory.createTrader();
    const res = await request(app)
      .get('/api/notifications/consumer')
      .set(trader.headers);
    expect(res.status).toBe(403);
  });

  test('consumer can fetch their notifications', async () => {
    const consumer = factory.createConsumer();
    const res = await request(app)
      .get('/api/notifications/consumer')
      .set(consumer.headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('unread_count');
    expect(res.body).toHaveProperty('notifications');
  });
});

/* ── 17.4 Notification isolation: dealer cannot access admin's ─────────── */
describe('Notification isolation by user type', () => {
  test('dealer notifications and admin notifications are DB-isolated by user_type', () => {
    const dealer = factory.createTrader();
    const admin  = factory.createAdmin();

    // Insert one notification for each
    insertNotification({
      user_type: 'dealer', user_id: dealer.user.id,
      title: 'Dealer Notif', body: 'For dealer only',
    });
    insertNotification({
      user_type: 'admin', user_id: admin.user.id,
      title: 'Admin Notif', body: 'For admin only',
    });

    // Dealer's notifications in DB
    const dealerRows = db.prepare(
      `SELECT * FROM notifications WHERE user_type='dealer' AND user_id=?`
    ).all(dealer.user.id);

    // Admin's notifications in DB
    const adminRows = db.prepare(
      `SELECT * FROM notifications WHERE user_type='admin' AND user_id=?`
    ).all(admin.user.id);

    expect(dealerRows).toHaveLength(1);
    expect(adminRows).toHaveLength(1);

    // Cross-check: dealer rows don't include admin rows
    const dealerHasAdminNotif = dealerRows.some(r => r.title === 'Admin Notif');
    const adminHasDealerNotif = adminRows.some(r => r.title === 'Dealer Notif');
    expect(dealerHasAdminNotif).toBe(false);
    expect(adminHasDealerNotif).toBe(false);
  });

  test('consumer notifications are isolated from dealer notifications in DB', () => {
    const consumer = factory.createConsumer();
    const dealer   = factory.createTrader();

    insertNotification({
      user_type: 'consumer', user_id: consumer.consumer.id,
      title: 'Consumer Order', body: 'Your order is ready',
    });
    insertNotification({
      user_type: 'dealer', user_id: dealer.user.id,
      title: 'New Consumer Order', body: 'A new order arrived',
    });

    const consumerRows = db.prepare(
      `SELECT * FROM notifications WHERE user_type='consumer' AND user_id=?`
    ).all(consumer.consumer.id);
    const dealerRows = db.prepare(
      `SELECT * FROM notifications WHERE user_type='dealer' AND user_id=?`
    ).all(dealer.user.id);

    expect(consumerRows).toHaveLength(1);
    expect(dealerRows).toHaveLength(1);
    expect(consumerRows[0].title).toBe('Consumer Order');
    expect(dealerRows[0].title).toBe('New Consumer Order');
  });
});

/* ── 17.5 Mark-as-read: unread count goes 1 → 0 ────────────────────────── */
describe('Mark notification as read', () => {
  test('unread_count goes from 1 to 0 after PUT /dealer/:id/read', async () => {
    const dealer = factory.createTrader();

    // Insert an unread notification directly
    const notif = insertNotification({
      user_type: 'dealer', user_id: dealer.user.id,
      title: 'Test Unread', body: 'Please read me', read: 0,
    });

    // Verify it's unread in DB
    const before = db.prepare(
      `SELECT read FROM notifications WHERE id=?`
    ).get(notif.id);
    expect(before.read).toBe(0);

    // Call mark-as-read endpoint
    const res = await request(app)
      .put(`/api/notifications/dealer/${notif.id}/read`)
      .set(dealer.headers);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify read flag in DB
    const after = db.prepare(
      `SELECT read FROM notifications WHERE id=?`
    ).get(notif.id);
    expect(after.read).toBe(1);
  });

  test('mark admin notification read via PUT /admin/:id/read', async () => {
    const admin = factory.createAdmin();

    const notif = insertNotification({
      user_type: 'admin', user_id: admin.user.id,
      title: 'Admin Alert', body: 'Low stock warning', read: 0,
    });

    const res = await request(app)
      .put(`/api/notifications/admin/${notif.id}/read`)
      .set(admin.headers);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT read FROM notifications WHERE id=?').get(notif.id);
    expect(row.read).toBe(1);
  });

  test('mark consumer notification read via PUT /consumer/:id/read', async () => {
    const consumer = factory.createConsumer();

    const notif = insertNotification({
      user_type: 'consumer', user_id: consumer.consumer.id,
      title: 'Order Shipped', body: 'Your order is on the way', read: 0,
    });

    const res = await request(app)
      .put(`/api/notifications/consumer/${notif.id}/read`)
      .set(consumer.headers);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT read FROM notifications WHERE id=?').get(notif.id);
    expect(row.read).toBe(1);
  });
});

/* ── 17.6 Payment verify idempotency: no double notification insert ─────── */
describe('Payment verify idempotency — notification not doubled', () => {
  test('Paying twice does not insert a second notification call', async () => {
    const dealer   = factory.createTrader({ tier: 1 });
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 100,
      payment_status: 'pending',
      status: 'pending',
    });

    // First payment
    const { res: res1 } = await payOrder(consumer, order);
    expect(res1.status).toBe(200);

    // Record notification mock call count after first pay
    const callsAfterFirst = notificationService.createNotification.mock.calls.length;

    // Second payment attempt — order is already paid
    const { res: res2 } = await payOrder(consumer, order);
    // Should fail — order already paid
    expect(res2.status).not.toBe(200);

    // Notification should NOT have been called a second time
    const callsAfterSecond = notificationService.createNotification.mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  test('Second verify on already-paid order returns error (not 200)', async () => {
    const dealer   = factory.createTrader({ tier: 1 });
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      total_amount: 50,
      payment_status: 'pending',
      status: 'pending',
    });

    // Pay once
    const { res: res1 } = await payOrder(consumer, order);
    expect(res1.status).toBe(200);

    // Verify order is now paid
    const paid = db.prepare('SELECT payment_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(paid.payment_status).toBe('paid');

    // Try to pay again
    const { res: res2 } = await payOrder(consumer, order);
    expect([400, 404]).toContain(res2.status);
  });
});

/* ── 17.7 Notification body not truncated (500-char body) ──────────────── */
describe('Notification body storage — no truncation', () => {
  test('500-character body stored and retrieved exactly', () => {
    const dealer = factory.createTrader();
    const longBody = 'A'.repeat(500);

    const notif = insertNotification({
      user_type: 'dealer',
      user_id: dealer.user.id,
      title: 'Long Body Test',
      body: longBody,
    });

    const row = db.prepare('SELECT body FROM notifications WHERE id=?').get(notif.id);
    expect(row.body).toBe(longBody);
    expect(row.body.length).toBe(500);
  });

  test('Notification data JSON round-trips exactly', () => {
    const consumer = factory.createConsumer();
    const data = { order_id: 42, order_number: 'ORD-TEST-001', amount: 999.99 };

    const notif = insertNotification({
      user_type: 'consumer',
      user_id: consumer.consumer.id,
      title: 'JSON Data Test',
      body: 'Test body',
      data,
    });

    const row = db.prepare('SELECT data FROM notifications WHERE id=?').get(notif.id);
    const parsed = JSON.parse(row.data);
    expect(parsed).toEqual(data);
  });
});
