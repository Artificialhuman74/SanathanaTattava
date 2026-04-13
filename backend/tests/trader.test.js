/**
 * Trader Route Tests — /api/trader
 *
 * Covers: profile, products, orders, consumer orders,
 * commissions, inventory, sub-dealer management,
 * data isolation (trader A can't see trader B's data).
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createAdmin, createTrader, createConsumer,
  createProduct, createConsumerOrder,
} = require('./helpers/factory');

const app = createApp();

beforeEach(() => clearAll());

// ─────────────────────────────────────────────────────────────────────────────
// Role Boundaries
// ─────────────────────────────────────────────────────────────────────────────
describe('Trader role enforcement', () => {
  test('admin token rejected on trader routes with 403', async () => {
    const { headers } = createAdmin();
    const res = await request(app).get('/api/trader/profile').set(headers);
    expect(res.status).toBe(403);
  });

  test('consumer token rejected with 401/403', async () => {
    const { headers } = createConsumer();
    const res = await request(app).get('/api/trader/profile').set(headers);
    expect([401, 403]).toContain(res.status);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/trader/profile');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/trader/profile', () => {
  test('returns trader profile without password', async () => {
    const { user, headers } = createTrader({ name: 'Profile Trader' });
    const res = await request(app).get('/api/trader/profile').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Profile Trader');
    expect(res.body.user.password).toBeUndefined();
  });
});

describe('PUT /api/trader/my-profile', () => {
  test('updates trader profile fields', async () => {
    const { headers } = createTrader();
    const res = await request(app)
      .put('/api/trader/my-profile')
      .set(headers)
      .send({ name: 'Updated Name', phone: '9876543210', address: 'New Address' });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Updated Name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/trader/products', () => {
  test('returns active products list', async () => {
    const { headers } = createTrader();
    createProduct({ name: 'Sesame Oil' });
    createProduct({ name: 'Coconut Oil' });

    const res = await request(app).get('/api/trader/products').set(headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBe(2);
  });

  test('does not return inactive products', async () => {
    const { headers } = createTrader();
    createProduct({ name: 'Active' });
    const inactive = createProduct({ name: 'Inactive' });
    db.prepare(`UPDATE products SET status='inactive' WHERE id=?`).run(inactive.id);

    const res = await request(app).get('/api/trader/products').set(headers);
    const names = res.body.products.map(p => p.name);
    expect(names).toContain('Active');
    expect(names).not.toContain('Inactive');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2B Orders (trader → admin)
// ─────────────────────────────────────────────────────────────────────────────
describe('B2B Orders', () => {
  test('POST /api/trader/orders places a B2B order', async () => {
    const { user, headers } = createTrader();
    const product = createProduct({ price: 100, stock: 50 });

    const res = await request(app)
      .post('/api/trader/orders')
      .set(headers)
      .send({
        items: [{ product_id: product.id, quantity: 5 }],
        notes: 'Test order',
      });

    expect(res.status).toBe(201);
    expect(res.body.order.trader_id).toBe(user.id);
    expect(res.body.order.total_amount).toBe(500); // 5 × 100
  });

  test('POST /api/trader/orders rejects order for out-of-stock product', async () => {
    const { headers } = createTrader();
    const product = createProduct({ stock: 2 });

    const res = await request(app)
      .post('/api/trader/orders')
      .set(headers)
      .send({ items: [{ product_id: product.id, quantity: 100 }] });

    expect(res.status).toBe(400);
  });

  test('GET /api/trader/orders returns only own orders', async () => {
    const { user: t1, headers: h1 } = createTrader();
    const { user: t2 }              = createTrader();

    // Create orders for both traders directly in DB
    const product = createProduct();
    db.prepare(`INSERT INTO orders (order_number,trader_id,status,subtotal,discount,total_amount) VALUES (?,?,'pending',100,0,100)`)
      .run('ORD-T1-001', t1.id);
    db.prepare(`INSERT INTO orders (order_number,trader_id,status,subtotal,discount,total_amount) VALUES (?,?,'pending',200,0,200)`)
      .run('ORD-T2-001', t2.id);

    const res = await request(app).get('/api/trader/orders').set(h1);

    expect(res.status).toBe(200);
    const orderTraderIds = res.body.orders.map(o => o.trader_id);
    expect(orderTraderIds.every(id => id === t1.id)).toBe(true);
    expect(orderTraderIds).not.toContain(t2.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Orders (routed to trader)
// ─────────────────────────────────────────────────────────────────────────────
describe('Consumer orders routed to trader', () => {
  test('GET /api/trader/consumer-orders returns only orders linked to this trader', async () => {
    const { user: t1, headers: h1 } = createTrader();
    const { user: t2 }              = createTrader();
    const { consumer: c1 }          = createConsumer({ linked_dealer_id: t1.id });
    const { consumer: c2 }          = createConsumer({ linked_dealer_id: t2.id });

    createConsumerOrder(c1.id, { linked_dealer_id: t1.id });
    createConsumerOrder(c2.id, { linked_dealer_id: t2.id });

    const res = await request(app).get('/api/trader/consumer-orders').set(h1);

    expect(res.status).toBe(200);
    const ids = res.body.orders.map(o => o.linked_dealer_id);
    expect(ids.every(id => id === t1.id)).toBe(true);
  });

  test('PUT /api/trader/consumer-orders/:id/status updates status (pending → confirmed)', async () => {
    const { user, headers } = createTrader();
    const { consumer }      = createConsumer({ linked_dealer_id: user.id });
    const order = createConsumerOrder(consumer.id, {
      linked_dealer_id: user.id,
      status:          'pending',
      delivery_status: 'pending',
    });

    const res = await request(app)
      .put(`/api/trader/consumer-orders/${order.id}/status`)
      .set(headers)
      .send({ status: 'confirmed' });

    // pending → confirmed does not trigger inventory deduction
    expect(res.status).toBe(200);
    const updated = db.prepare('SELECT status FROM consumer_orders WHERE id=?').get(order.id);
    expect(updated.status).toBe('confirmed');
  });

  test("trader cannot update another trader's consumer order", async () => {
    const { user: t1 }       = createTrader();
    const { headers: h2 }    = createTrader();
    const { consumer }       = createConsumer({ linked_dealer_id: t1.id });
    const order = createConsumerOrder(consumer.id, { linked_dealer_id: t1.id });

    const res = await request(app)
      .put(`/api/trader/consumer-orders/${order.id}/status`)
      .set(h2)
      .send({ status: 'processing' });

    // Should be 404 (not found for this trader) or 403
    expect([403, 404]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Dealers
// ─────────────────────────────────────────────────────────────────────────────
describe('Sub-dealer management', () => {
  test('GET /api/trader/sub-dealers returns only own sub-dealers', async () => {
    const { user: parent, headers } = createTrader({ tier: 1, referral_code: 'F0000' });
    const { user: child  }          = createTrader({ tier: 2, referral_code: 'F0001' });
    db.prepare('UPDATE users SET referred_by_id=? WHERE id=?').run(parent.id, child.id);

    const { user: other } = createTrader({ tier: 2, referral_code: 'G0001' });
    // other is NOT under parent

    const res = await request(app).get('/api/trader/sub-dealers').set(headers);

    expect(res.status).toBe(200);
    const ids = res.body.subDealers.map(d => d.id);
    expect(ids).toContain(child.id);
    expect(ids).not.toContain(other.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/trader/inventory', () => {
  test('returns dealer inventory rows', async () => {
    const { user, headers } = createTrader();
    const product = createProduct();
    db.prepare('INSERT INTO dealer_inventory (dealer_id, product_id, quantity) VALUES (?,?,?)')
      .run(user.id, product.id, 30);

    const res = await request(app).get('/api/trader/inventory').set(headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.inventory)).toBe(true);
    const item = res.body.inventory.find(i => i.product_id === product.id);
    expect(item.quantity).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Commissions
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/trader/commissions', () => {
  test('returns commissions for own trader only', async () => {
    const { user: t1, headers: h1 } = createTrader();
    const { user: t2 }              = createTrader();
    const { consumer }              = createConsumer();
    const order = createConsumerOrder(consumer.id);

    db.prepare('INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status) VALUES (?,?,?,?,?,?)')
      .run(t1.id, order.id, 50, 10, 'direct', 'pending');
    db.prepare('INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status) VALUES (?,?,?,?,?,?)')
      .run(t2.id, order.id, 30, 10, 'direct', 'pending');

    const res = await request(app).get('/api/trader/commissions').set(h1);

    expect(res.status).toBe(200);
    const traderIds = res.body.commissions.map(c => c.trader_id);
    expect(traderIds.every(id => id === t1.id)).toBe(true);
  });
});
