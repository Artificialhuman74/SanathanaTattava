/**
 * Admin Route Tests — /api/admin
 *
 * Covers: dashboard stats, product CRUD, trader management,
 * order management, inventory distribution, commission processing,
 * role boundary enforcement.
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
describe('Admin role enforcement', () => {
  test('trader token is rejected with 403 on admin routes', async () => {
    const { headers } = createTrader();
    const res = await request(app).get('/api/admin/stats').set(headers);
    expect(res.status).toBe(403);
  });

  test('consumer token is rejected with 401/403 on admin routes', async () => {
    const { headers } = createConsumer();
    const res = await request(app).get('/api/admin/stats').set(headers);
    expect([401, 403]).toContain(res.status);
  });

  test('missing token returns 401', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/stats', () => {
  test('returns correct counts after seeding data', async () => {
    const { headers } = createAdmin();
    createTrader();
    createTrader();
    createProduct();
    const res = await request(app).get('/api/admin/stats').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.totalTraders).toBe(2);
    expect(res.body.totalProducts).toBe(1);
    expect(typeof res.body.revenue).toBe('number');
    expect(Array.isArray(res.body.recentCOrders)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Product CRUD
// ─────────────────────────────────────────────────────────────────────────────
describe('Product management', () => {
  let admin;
  beforeEach(() => { admin = createAdmin(); });

  test('GET /api/admin/products returns all products', async () => {
    createProduct({ name: 'Incense Sticks', category: 'pooja' });
    createProduct({ name: 'Holy Water',     category: 'pooja' });
    const res = await request(app).get('/api/admin/products').set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.products.length).toBe(2);
  });

  test('POST /api/admin/products creates a product', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set(admin.headers)
      .send({
        name: 'Turmeric',
        category: 'spices',
        sku: 'TRM-001',
        price: 50,
        stock: 200,
        unit: 'kg',
      });

    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe('Turmeric');
    expect(res.body.product.sku).toBe('TRM-001');
  });

  test('POST /api/admin/products rejects duplicate SKU', async () => {
    createProduct({ sku: 'UNIQUE-001' });
    const res = await request(app)
      .post('/api/admin/products')
      .set(admin.headers)
      .send({ name: 'Dup', category: 'x', sku: 'UNIQUE-001', price: 10, stock: 10 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/sku.*exists/i);
  });

  test('POST /api/admin/products rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set(admin.headers)
      .send({ name: 'No SKU', category: 'x', price: 10 }); // missing sku

    expect(res.status).toBe(400);
  });

  test('PUT /api/admin/products/:id updates product', async () => {
    const product = createProduct({ name: 'Old Name', price: 100 });
    const res = await request(app)
      .put(`/api/admin/products/${product.id}`)
      .set(admin.headers)
      .send({ name: 'New Name', price: 150 });

    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('New Name');
    expect(res.body.product.price).toBe(150);
  });

  test('DELETE /api/admin/products/:id soft-deletes product', async () => {
    const product = createProduct();
    const res = await request(app)
      .delete(`/api/admin/products/${product.id}`)
      .set(admin.headers);

    expect(res.status).toBe(200);
    // Product should be inactive, not physically deleted
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(product.id);
    expect(p).toBeDefined(); // still exists
    expect(p.status).toBe('inactive'); // just deactivated
  });

  test('PUT /api/admin/products/:id returns 404 for unknown product', async () => {
    const res = await request(app)
      .put('/api/admin/products/99999')
      .set(admin.headers)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trader Management
// ─────────────────────────────────────────────────────────────────────────────
describe('Trader management', () => {
  let admin;
  beforeEach(() => { admin = createAdmin(); });

  test('GET /api/admin/traders lists all traders', async () => {
    createTrader();
    createTrader();
    const res = await request(app).get('/api/admin/traders').set(admin.headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.traders)).toBe(true);
    expect(res.body.traders.length).toBe(2);
    // Passwords must never appear in response
    res.body.traders.forEach(t => expect(t.password).toBeUndefined());
  });

  test('PUT /api/admin/traders/:id/status suspends a trader', async () => {
    const { user } = createTrader();
    const res = await request(app)
      .put(`/api/admin/traders/${user.id}/status`)
      .set(admin.headers)
      .send({ status: 'suspended' });

    expect(res.status).toBe(200);
    const updated = db.prepare('SELECT status FROM users WHERE id = ?').get(user.id);
    expect(updated.status).toBe('suspended');
  });

  test('suspended trader cannot log in', async () => {
    const { user } = createTrader({ email: 'suspended2@test.com' });
    await request(app)
      .put(`/api/admin/traders/${user.id}/status`)
      .set(admin.headers)
      .send({ status: 'suspended' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'suspended2@test.com', password: 'TraderPass1!' });

    expect(loginRes.status).toBe(403);
  });

  test('PUT /api/admin/traders/:id/commission-rate updates commission', async () => {
    const { user } = createTrader();
    const res = await request(app)
      .put(`/api/admin/traders/${user.id}/commission-rate`)
      .set(admin.headers)
      .send({ commission_rate: 15 });

    expect(res.status).toBe(200);
    const updated = db.prepare('SELECT commission_rate FROM users WHERE id = ?').get(user.id);
    expect(updated.commission_rate).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Orders
// ─────────────────────────────────────────────────────────────────────────────
describe('Consumer order management', () => {
  let admin;
  beforeEach(() => { admin = createAdmin(); });

  test('GET /api/admin/consumer-orders returns all consumer orders', async () => {
    const { consumer } = createConsumer();
    createConsumerOrder(consumer.id);
    createConsumerOrder(consumer.id);

    const res = await request(app).get('/api/admin/consumer-orders').set(admin.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body.orders.length).toBe(2);
  });

  test('PUT /api/admin/consumer-orders/:id/status updates status', async () => {
    const { consumer } = createConsumer();
    const order = createConsumerOrder(consumer.id, { status: 'pending' });

    const res = await request(app)
      .put(`/api/admin/consumer-orders/${order.id}/status`)
      .set(admin.headers)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(200);
    const updated = db.prepare('SELECT status FROM consumer_orders WHERE id = ?').get(order.id);
    expect(updated.status).toBe('confirmed');
  });

  test('GET /api/admin/consumer-orders/:id returns order with items', async () => {
    const { consumer } = createConsumer();
    const product = createProduct();
    const order   = createConsumerOrder(consumer.id);
    db.prepare('INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?,?,?,?,?)')
      .run(order.id, product.id, 2, product.price, product.price * 2);

    const res = await request(app)
      .get(`/api/admin/consumer-orders/${order.id}`)
      .set(admin.headers);

    expect(res.status).toBe(200);
    // Route returns { order, items, commissions } at top level
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventory Management
// ─────────────────────────────────────────────────────────────────────────────
describe('Inventory management', () => {
  let admin;
  beforeEach(() => { admin = createAdmin(); });

  test('GET /api/admin/inventory/warehouse returns warehouse stock', async () => {
    createProduct({ name: 'Ghee', stock: 100 });
    createProduct({ name: 'Honey', stock: 50 });

    const res = await request(app).get('/api/admin/inventory/warehouse').set(admin.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  test('GET /api/admin/inventory/alerts returns low-stock dealer inventory rows', async () => {
    // Alerts come from dealer_inventory table, not the products.stock field
    const lowProduct = createProduct({ name: 'Low Stock Item' });
    const okProduct  = createProduct({ name: 'OK Stock Item' });
    const { user: dealer } = createTrader();

    // dealer has 2 units of lowProduct but threshold is 10 → ALERT
    db.prepare('INSERT INTO dealer_inventory (dealer_id, product_id, quantity, low_stock_threshold) VALUES (?,?,?,?)')
      .run(dealer.id, lowProduct.id, 2, 10);
    // dealer has 100 units of okProduct → no alert
    db.prepare('INSERT INTO dealer_inventory (dealer_id, product_id, quantity, low_stock_threshold) VALUES (?,?,?,?)')
      .run(dealer.id, okProduct.id, 100, 10);

    const res = await request(app).get('/api/admin/inventory/alerts').set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body.alerts.length).toBeGreaterThanOrEqual(1);
    const names = res.body.alerts.map(a => a.product_name);
    expect(names).toContain('Low Stock Item');
    expect(names).not.toContain('OK Stock Item');
  });

  test('POST /api/admin/inventory/distribute allocates stock to dealer', async () => {
    const product          = createProduct({ stock: 100 });
    const { user: dealer } = createTrader();

    const res = await request(app)
      .post('/api/admin/inventory/distribute')
      .set(admin.headers)
      .send({
        product_id:  product.id,
        allocations: [{ dealer_id: dealer.id, quantity: 20 }],
        notes:       'Test allocation',
      });

    expect(res.status).toBe(200);
    const inv = db.prepare('SELECT quantity FROM dealer_inventory WHERE dealer_id=? AND product_id=?')
      .get(dealer.id, product.id);
    expect(inv.quantity).toBe(20);
    // Warehouse stock should decrease by allocated amount
    const warehouse = db.prepare('SELECT stock FROM products WHERE id=?').get(product.id);
    expect(warehouse.stock).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────
describe('Settings management', () => {
  test('GET /api/admin/settings returns platform settings', async () => {
    const { headers } = createAdmin();
    const res = await request(app).get('/api/admin/settings').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
  });

  test('PUT /api/admin/settings updates referral discount', async () => {
    const { headers } = createAdmin();
    const res = await request(app)
      .put('/api/admin/settings')
      .set(headers)
      .send({ referral_discount_percent: 15 });

    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'referral_discount_percent'`).get();
    expect(parseFloat(row.value)).toBe(15);
  });
});
