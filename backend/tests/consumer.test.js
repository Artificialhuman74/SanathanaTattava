/**
 * Consumer Route Tests — /api/consumer
 *
 * Covers: product browsing, profile management, address CRUD,
 * order placement, referral discount application,
 * auth boundary (must use consumer token, not trader token).
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createTrader, createConsumer,
  createProduct, createConsumerOrder,
} = require('./helpers/factory');

const app = createApp();

beforeEach(() => clearAll());

// ─────────────────────────────────────────────────────────────────────────────
// Auth Boundary
// ─────────────────────────────────────────────────────────────────────────────
describe('Consumer auth enforcement', () => {
  test('trader token is rejected on consumer protected routes', async () => {
    const { headers } = createTrader();
    const res = await request(app).get('/api/consumer/me').set(headers);
    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/consumer/me');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Public consumer endpoints', () => {
  test('GET /api/consumer/products returns active products with categories', async () => {
    createProduct({ name: 'Ghee',  category: 'dairy' });
    createProduct({ name: 'Honey', category: 'natural' });
    const inactive = createProduct({ name: 'Hidden', category: 'dairy' });
    db.prepare(`UPDATE products SET status='inactive' WHERE id=?`).run(inactive.id);

    const res = await request(app).get('/api/consumer/products');

    expect(res.status).toBe(200);
    const names = res.body.products.map(p => p.name);
    expect(names).toContain('Ghee');
    expect(names).toContain('Honey');
    expect(names).not.toContain('Hidden');
    expect(res.body.categories).toContain('dairy');
  });

  test('GET /api/consumer/products?search= filters by name', async () => {
    createProduct({ name: 'Sesame Oil' });
    createProduct({ name: 'Coconut Milk' });

    const res = await request(app).get('/api/consumer/products?search=sesame');

    expect(res.status).toBe(200);
    expect(res.body.products.length).toBe(1);
    expect(res.body.products[0].name).toBe('Sesame Oil');
  });

  test('GET /api/consumer/products?category= filters by category', async () => {
    createProduct({ name: 'Rice',  category: 'grains' });
    createProduct({ name: 'Wheat', category: 'grains' });
    createProduct({ name: 'Milk',  category: 'dairy'  });

    const res = await request(app).get('/api/consumer/products?category=grains');

    expect(res.status).toBe(200);
    expect(res.body.products.length).toBe(2);
    res.body.products.forEach(p => expect(p.category).toBe('grains'));
  });

  test('GET /api/consumer/products/:id returns single product', async () => {
    const product = createProduct({ name: 'Single Product' });
    const res = await request(app).get(`/api/consumer/products/${product.id}`);

    expect(res.status).toBe(200);
    expect(res.body.product.id).toBe(product.id);
  });

  test('GET /api/consumer/products/:id returns 404 for inactive product', async () => {
    const product = createProduct();
    db.prepare(`UPDATE products SET status='inactive' WHERE id=?`).run(product.id);

    const res = await request(app).get(`/api/consumer/products/${product.id}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/consumer/settings returns referral discount percent', async () => {
    const res = await request(app).get('/api/consumer/settings');
    expect(res.status).toBe(200);
    expect(typeof res.body.referral_discount_percent).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Profile
// ─────────────────────────────────────────────────────────────────────────────
describe('Consumer profile', () => {
  test('GET /api/consumer/me returns consumer without password', async () => {
    const { consumer, headers } = createConsumer({ name: 'Profile Test' });
    const res = await request(app).get('/api/consumer/me').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.consumer.name).toBe('Profile Test');
    expect(res.body.consumer.password).toBeUndefined();
  });

  test('GET /api/consumer/me includes linked dealer info', async () => {
    const { user: dealer } = createTrader({ name: 'Linked Dealer' });
    const { headers }      = createConsumer({ linked_dealer_id: dealer.id });

    const res = await request(app).get('/api/consumer/me').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.consumer.dealer).toBeDefined();
    expect(res.body.consumer.dealer.name).toBe('Linked Dealer');
  });

  test('PATCH /api/consumer/me updates name', async () => {
    const { headers } = createConsumer();
    const res = await request(app)
      .patch('/api/consumer/me')
      .set(headers)
      .send({ name: 'Updated Consumer Name' });

    expect(res.status).toBe(200);
    expect(res.body.consumer.name).toBe('Updated Consumer Name');
  });

  test('PATCH /api/consumer/me rejects empty name', async () => {
    const { headers } = createConsumer();
    const res = await request(app)
      .patch('/api/consumer/me')
      .set(headers)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
  });

  test('POST /api/consumer/change-password updates password', async () => {
    const { consumer, headers } = createConsumer({ email: 'passchange@test.com', password: 'OldPass123!' });
    const res = await request(app)
      .post('/api/consumer/change-password')
      .set(headers)
      .send({ old_password: 'OldPass123!', new_password: 'NewPass456!' });

    expect(res.status).toBe(200);

    // Verify new password works on login
    const loginRes = await request(app)
      .post('/api/auth/consumer/login')
      .send({ email: 'passchange@test.com', password: 'NewPass456!' });
    expect(loginRes.status).toBe(200);
  });

  test('POST /api/consumer/change-password rejects wrong old password', async () => {
    const { headers } = createConsumer();
    const res = await request(app)
      .post('/api/consumer/change-password')
      .set(headers)
      .send({ old_password: 'WrongOldPass', new_password: 'NewPass456!' });

    // API returns 401 when old password doesn't match
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Addresses
// ─────────────────────────────────────────────────────────────────────────────
describe('Consumer addresses', () => {
  let consumerCtx;

  beforeEach(() => {
    consumerCtx = createConsumer();
  });

  test('POST /api/consumer/addresses saves a new address', async () => {
    const res = await request(app)
      .post('/api/consumer/addresses')
      .set(consumerCtx.headers)
      .send({
        label: 'Home',
        name: 'Test User',
        phone: '9876543210',
        address: '123 Temple Street, Bangalore',
        pincode: '560001',
      });

    expect(res.status).toBe(201);
    expect(res.body.address.label).toBe('Home');
  });

  test('GET /api/consumer/addresses returns only own addresses', async () => {
    const { consumer, headers } = consumerCtx;
    const { consumer: other }   = createConsumer();

    // Own address
    db.prepare('INSERT INTO consumer_addresses (consumer_id, label, name, phone, address, pincode) VALUES (?,?,?,?,?,?)')
      .run(consumer.id, 'Home', 'Me', '111', 'My Street', '560001');
    // Other consumer's address
    db.prepare('INSERT INTO consumer_addresses (consumer_id, label, name, phone, address, pincode) VALUES (?,?,?,?,?,?)')
      .run(other.id, 'Office', 'Other', '222', 'Other Street', '560002');

    const res = await request(app).get('/api/consumer/addresses').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.addresses.every(a => a.consumer_id === consumer.id)).toBe(true);
  });

  test('PUT /api/consumer/addresses/:id updates address', async () => {
    const { consumer, headers } = consumerCtx;
    const r = db.prepare('INSERT INTO consumer_addresses (consumer_id, label, name, phone, address, pincode) VALUES (?,?,?,?,?,?)')
      .run(consumer.id, 'Home', 'Old Name', '9876543210', 'Old St', '560001');

    const res = await request(app)
      .put(`/api/consumer/addresses/${r.lastInsertRowid}`)
      .set(headers)
      .send({ label: 'Office', name: 'New Name', phone: '9876543210', address: 'New St', pincode: '560002' });

    expect(res.status).toBe(200);
    expect(res.body.address.label).toBe('Office');
  });

  test('DELETE /api/consumer/addresses/:id removes address', async () => {
    const { consumer, headers } = consumerCtx;
    const r = db.prepare('INSERT INTO consumer_addresses (consumer_id, label, name, phone, address, pincode) VALUES (?,?,?,?,?,?)')
      .run(consumer.id, 'Home', 'Test', '9876543210', 'Test St', '560001');

    const res = await request(app)
      .delete(`/api/consumer/addresses/${r.lastInsertRowid}`)
      .set(headers);

    expect(res.status).toBe(200);
    const deleted = db.prepare('SELECT * FROM consumer_addresses WHERE id=?').get(r.lastInsertRowid);
    expect(deleted).toBeUndefined();
  });

  test('consumer cannot update another consumer\'s address', async () => {
    const { consumer: other }  = createConsumer();
    const { headers: h2 }      = createConsumer();
    const r = db.prepare('INSERT INTO consumer_addresses (consumer_id, label, name, phone, address, pincode) VALUES (?,?,?,?,?,?)')
      .run(other.id, 'Home', 'Other', '9999999999', 'Their St', '560003');

    const res = await request(app)
      .put(`/api/consumer/addresses/${r.lastInsertRowid}`)
      .set(h2)
      .send({ label: 'Hijack', name: 'Hijack', phone: '9876543210', address: 'Bad St', pincode: '000000' });

    expect([403, 404]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────
describe('Consumer orders', () => {
  test('GET /api/consumer/orders returns own orders only', async () => {
    const { consumer: c1, headers: h1 } = createConsumer();
    const { consumer: c2 }              = createConsumer();

    createConsumerOrder(c1.id);
    createConsumerOrder(c2.id);

    const res = await request(app).get('/api/consumer/orders').set(h1);

    expect(res.status).toBe(200);
    expect(res.body.orders.every(o => o.consumer_id === c1.id)).toBe(true);
    expect(res.body.orders.length).toBe(1);
  });

  test('GET /api/consumer/orders/:id returns order with items', async () => {
    const { consumer, headers } = createConsumer();
    const product = createProduct();
    const order   = createConsumerOrder(consumer.id);
    db.prepare('INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?,?,?,?,?)')
      .run(order.id, product.id, 3, 100, 300);

    const res = await request(app).get(`/api/consumer/orders/${order.id}`).set(headers);

    expect(res.status).toBe(200);
    // Route returns { order, items } at top level
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].quantity).toBe(3);
  });

  test('consumer cannot view another consumer\'s order', async () => {
    const { consumer: c1 }       = createConsumer();
    const { headers: h2 }        = createConsumer();
    const order = createConsumerOrder(c1.id);

    const res = await request(app).get(`/api/consumer/orders/${order.id}`).set(h2);
    expect([403, 404]).toContain(res.status);
  });

  test('POST /api/consumer/orders — referral discount applied for linked consumers', async () => {
    const { user: dealer } = createTrader({ tier: 1, referral_code: 'H0000' });
    const { consumer, headers } = createConsumer({ linked_dealer_id: dealer.id });
    const product = createProduct({ price: 100, stock: 20 });

    // Save delivery address
    const addrR = db.prepare(`
      INSERT INTO consumer_addresses (consumer_id, label, name, phone, address, pincode, latitude, longitude, is_default)
      VALUES (?,?,?,?,?,?,?,?,1)
    `).run(consumer.id, 'Home', 'Test', '9876543210', '1 Test St', '560001', 12.9716, 77.5946);

    // Update settings to 10% discount
    db.prepare(`UPDATE settings SET value='10' WHERE key='referral_discount_percent'`).run();

    const res = await request(app)
      .post('/api/consumer/orders')
      .set(headers)
      .send({
        items: [{ product_id: product.id, quantity: 2 }],
        address_id: addrR.lastInsertRowid,
        pincode: '560001',
        delivery_address: '1 Test St, Bangalore',
        notes: 'Test order with discount',
      });

    expect(res.status).toBe(201);
    // 2 × 100 = 200, 10% discount = 20, total = 180
    expect(res.body.order.discount_amount).toBeCloseTo(20, 1);
    expect(res.body.order.total_amount).toBeCloseTo(180, 1);
  });
});
