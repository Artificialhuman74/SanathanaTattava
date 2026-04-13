/**
 * Delivery Flow Tests — /api/delivery
 *
 * Covers the complete delivery state machine:
 *   pending → accepted → packed → out_for_delivery → delivered
 *
 * Also covers: OTP verification, wrong OTP rejection,
 * can't skip states, can't deliver someone else's order.
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createTrader, createConsumer,
  createProduct, createConsumerOrder,
} = require('./helpers/factory');

const app = createApp();

// Helper: set up a fully-assigned order ready for a delivery dealer
function setupDeliveryOrder(deliveryDealer, overrides = {}) {
  const { consumer } = createConsumer();
  const order = createConsumerOrder(consumer.id, {
    status:             overrides.status             || 'confirmed',
    payment_status:     overrides.payment_status     || 'paid',
    delivery_dealer_id: deliveryDealer.id,
    delivery_status:    overrides.delivery_status    || 'pending',
  });
  return { consumer, order };
}

beforeEach(() => clearAll());

// ─────────────────────────────────────────────────────────────────────────────
// Role Boundaries
// ─────────────────────────────────────────────────────────────────────────────
describe('Delivery role enforcement', () => {
  test('non-trader token returns 401/403', async () => {
    const { headers } = createConsumer();
    const res = await request(app).get('/api/delivery/orders/assigned').set(headers);
    expect([401, 403]).toContain(res.status);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/delivery/orders/assigned');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// List Assigned Orders
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/delivery/orders/assigned', () => {
  test('returns only orders assigned to the requesting dealer', async () => {
    const { user: d1, headers: h1 } = createTrader();
    const { user: d2 }              = createTrader();
    const { consumer: c1 }          = createConsumer();
    const { consumer: c2 }          = createConsumer();

    createConsumerOrder(c1.id, { delivery_dealer_id: d1.id, delivery_status: 'pending' });
    createConsumerOrder(c2.id, { delivery_dealer_id: d2.id, delivery_status: 'pending' });

    const res = await request(app).get('/api/delivery/orders/assigned').set(h1);

    expect(res.status).toBe(200);
    expect(res.body.orders.every(o => o.delivery_dealer_id === d1.id)).toBe(true);
    expect(res.body.orders.length).toBe(1);
  });

  test('supports filtering by delivery_status', async () => {
    const { user: dealer, headers } = createTrader();
    const { consumer: c1 }          = createConsumer();
    const { consumer: c2 }          = createConsumer();

    createConsumerOrder(c1.id, { delivery_dealer_id: dealer.id, delivery_status: 'pending'  });
    createConsumerOrder(c2.id, { delivery_dealer_id: dealer.id, delivery_status: 'accepted' });

    const res = await request(app)
      .get('/api/delivery/orders/assigned?delivery_status=pending')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.orders.every(o => o.delivery_status === 'pending')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Complete Delivery State Machine
// ─────────────────────────────────────────────────────────────────────────────
describe('Delivery state machine', () => {
  test('full happy path: pending → accepted → packed → out_for_delivery → delivered', async () => {
    const { user: dealer, headers } = createTrader();
    const { order } = setupDeliveryOrder(dealer, { delivery_status: 'pending' });

    // Step 1: Accept
    let res = await request(app)
      .post(`/api/delivery/orders/${order.id}/accept`)
      .set(headers);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT delivery_status FROM consumer_orders WHERE id=?').get(order.id).delivery_status)
      .toBe('accepted');

    // Step 2: Pack
    res = await request(app)
      .post(`/api/delivery/orders/${order.id}/packed`)
      .set(headers);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT delivery_status FROM consumer_orders WHERE id=?').get(order.id).delivery_status)
      .toBe('packed');

    // Step 3: Start delivery (generates OTP)
    res = await request(app)
      .post(`/api/delivery/orders/${order.id}/start-delivery`)
      .set(headers);
    expect(res.status).toBe(200);
    const afterStart = db.prepare('SELECT * FROM consumer_orders WHERE id=?').get(order.id);
    expect(afterStart.delivery_status).toBe('out_for_delivery');
    expect(afterStart.delivery_otp).toMatch(/^\d{6}$/);

    // Step 4: Verify OTP (correct)
    res = await request(app)
      .post(`/api/delivery/orders/${order.id}/verify-otp`)
      .set(headers)
      .send({ otp: afterStart.delivery_otp });
    expect(res.status).toBe(200);
    const afterVerify = db.prepare('SELECT * FROM consumer_orders WHERE id=?').get(order.id);
    expect(afterVerify.delivery_status).toBe('delivered');
    expect(afterVerify.delivery_verified_at).not.toBeNull();
    expect(afterVerify.status).toBe('delivered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State Machine — Cannot Skip States
// ─────────────────────────────────────────────────────────────────────────────
describe('State machine cannot skip states', () => {
  test('cannot mark packed without accepting first', async () => {
    const { user: dealer, headers } = createTrader();
    const { order } = setupDeliveryOrder(dealer, { delivery_status: 'pending' });

    const res = await request(app)
      .post(`/api/delivery/orders/${order.id}/packed`)
      .set(headers);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accepted/i);
  });

  test('cannot start-delivery without packing first', async () => {
    const { user: dealer, headers } = createTrader();
    const { order } = setupDeliveryOrder(dealer, { delivery_status: 'accepted' });

    const res = await request(app)
      .post(`/api/delivery/orders/${order.id}/start-delivery`)
      .set(headers);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/packed/i);
  });

  test('cannot verify-otp before delivery is started', async () => {
    const { user: dealer, headers } = createTrader();
    const { order } = setupDeliveryOrder(dealer, { delivery_status: 'packed' });

    const res = await request(app)
      .post(`/api/delivery/orders/${order.id}/verify-otp`)
      .set(headers)
      .send({ otp: '123456' });

    // Should be 400 (wrong state) or 400 (wrong OTP) — either indicates guard is working
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OTP Security
// ─────────────────────────────────────────────────────────────────────────────
describe('OTP security', () => {
  test('rejects wrong OTP', async () => {
    const { user: dealer, headers } = createTrader();
    const { order } = setupDeliveryOrder(dealer, { delivery_status: 'pending' });

    // Advance to out_for_delivery
    await request(app).post(`/api/delivery/orders/${order.id}/accept`).set(headers);
    await request(app).post(`/api/delivery/orders/${order.id}/packed`).set(headers);
    await request(app).post(`/api/delivery/orders/${order.id}/start-delivery`).set(headers);

    const res = await request(app)
      .post(`/api/delivery/orders/${order.id}/verify-otp`)
      .set(headers)
      .send({ otp: '000000' }); // definitely wrong

    expect(res.status).toBe(400);
    // Order must NOT be marked delivered
    const still = db.prepare('SELECT delivery_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(still.delivery_status).toBe('out_for_delivery');
  });

  test('OTP must be exactly 6 digits', async () => {
    const { user: dealer, headers } = createTrader();
    const { order } = setupDeliveryOrder(dealer, { delivery_status: 'out_for_delivery' });
    db.prepare(`UPDATE consumer_orders SET delivery_otp='123456' WHERE id=?`).run(order.id);

    const tooShort = await request(app)
      .post(`/api/delivery/orders/${order.id}/verify-otp`)
      .set(headers)
      .send({ otp: '123' });

    expect(tooShort.status).toBe(400);

    const tooLong = await request(app)
      .post(`/api/delivery/orders/${order.id}/verify-otp`)
      .set(headers)
      .send({ otp: '1234567' });

    expect(tooLong.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Data Isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('Delivery data isolation', () => {
  test('dealer cannot accept an order assigned to a different dealer', async () => {
    const { user: d1 }           = createTrader();
    const { user: d2, headers: h2 } = createTrader();
    const { consumer }           = createConsumer();
    const order = createConsumerOrder(consumer.id, {
      delivery_dealer_id: d1.id,
      delivery_status: 'pending',
    });

    const res = await request(app)
      .post(`/api/delivery/orders/${order.id}/accept`)
      .set(h2); // d2 tries to accept d1's order

    expect(res.status).toBe(404); // not found for d2
  });

  test('GET /api/delivery/orders/:id returns 404 for unassigned order', async () => {
    const { user: d1, headers: h1 } = createTrader();
    const { user: d2 }              = createTrader();
    const { consumer }              = createConsumer();
    const order = createConsumerOrder(consumer.id, { delivery_dealer_id: d2.id });

    const res = await request(app).get(`/api/delivery/orders/${order.id}`).set(h1);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/delivery/stats', () => {
  test('returns delivery stats for the dealer', async () => {
    const { user: dealer, headers } = createTrader();
    const { consumer }              = createConsumer();

    // Create a delivered order
    createConsumerOrder(consumer.id, {
      delivery_dealer_id: dealer.id,
      status: 'delivered',
      delivery_status: 'delivered',
    });

    const res = await request(app).get('/api/delivery/stats').set(headers);
    expect(res.status).toBe(200);
    // Should include total delivered count
    expect(typeof res.body.totalDelivered !== 'undefined' ||
           typeof res.body.delivered     !== 'undefined' ||
           typeof res.body.stats         !== 'undefined'
    ).toBe(true);
  });
});
