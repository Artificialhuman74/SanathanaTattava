/**
 * Phase 8 — admin holdings route tests.
 *
 *   GET  /api/admin/holdings
 *   GET  /api/admin/holdings/:id
 *   POST /api/admin/holdings/:id/override
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createConsumer, createAdmin, createTrader, createProduct,
} = require('./helpers/factory');

const app = createApp();

function seedHolding(consumerId, overrides = {}) {
  const product = createProduct({ container_type: '5L' });
  const orderId = db.prepare(`
    INSERT INTO consumer_orders
      (order_number, consumer_id, status, payment_status,
       subtotal, total_amount, pincode, delivery_address, delivery_status)
    VALUES (?, ?, 'paid', 'paid', 100, 100, '560001', 'addr', 'pending')
  `).run(`OR-${Math.random()}`, consumerId).lastInsertRowid;
  const itemId = db.prepare(`
    INSERT INTO consumer_order_items
      (order_id, product_id, quantity, price, total, container_cost)
    VALUES (?, ?, 1, 100, 100, 100)
  `).run(orderId, product.id).lastInsertRowid;
  const invoiceId = db.prepare(`
    INSERT INTO invoices
      (invoice_number, order_id, customer_name, items_json, taxable_amount,
       total_amount, container_deposit, invoice_type)
    VALUES (?, ?, 'x', '[]', 0, 0, 0, 'tax')
  `).run(`INV-${Math.random()}`, orderId).lastInsertRowid;
  const r = db.prepare(`
    INSERT INTO container_holdings
      (invoice_id, order_item_id, original_product_id, current_product_id,
       consumer_id, container_type, deposit_amount, status, refund_destination)
    VALUES (?, ?, ?, ?, ?, '5L', 100, ?, ?)
  `).run(
    invoiceId, itemId, product.id, product.id, consumerId,
    overrides.status || 'held',
    overrides.refund_destination || null,
  );
  return r.lastInsertRowid;
}

beforeEach(() => clearAll());

describe('GET /api/admin/holdings', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/admin/holdings');
    expect(res.status).toBe(401);
  });

  test('403 for trader', async () => {
    const { headers } = createTrader();
    const res = await request(app).get('/api/admin/holdings').set(headers);
    expect(res.status).toBe(403);
  });

  test('admin gets list + statusCounts', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'refund_requested' });

    const res = await request(app).get('/api/admin/holdings').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.holdings.length).toBe(3);
    expect(res.body.statusCounts.held).toBe(2);
    expect(res.body.statusCounts.refund_requested).toBe(1);
  });

  test('filter by status query', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'refund_requested' });

    const res = await request(app)
      .get('/api/admin/holdings?status=refund_requested')
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.holdings.length).toBe(1);
    expect(res.body.holdings[0].status).toBe('refund_requested');
  });

  test('search query matches consumer name', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer({ name: 'Zelda Findme' });
    const { consumer: other } = createConsumer({ name: 'Hidden User' });
    seedHolding(consumer.id);
    seedHolding(other.id);

    const res = await request(app)
      .get('/api/admin/holdings?search=Zelda')
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.holdings.length).toBe(1);
    expect(res.body.holdings[0].consumer_name).toBe('Zelda Findme');
  });
});

describe('GET /api/admin/holdings/:id', () => {
  test('404 when missing', async () => {
    const { headers } = createAdmin();
    const res = await request(app).get('/api/admin/holdings/99999').set(headers);
    expect(res.status).toBe(404);
  });

  test('returns holding + audit', async () => {
    const { headers, user: admin } = createAdmin();
    const { consumer } = createConsumer();
    const holdingId = seedHolding(consumer.id, { status: 'held' });
    // Generate one audit entry
    await request(app)
      .post(`/api/admin/holdings/${holdingId}/override`)
      .set(headers)
      .send({ new_status: 'refund_requested', notes: 'admin notes' });

    const res = await request(app).get(`/api/admin/holdings/${holdingId}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.holding.id).toBe(holdingId);
    expect(res.body.audit.length).toBe(1);
    expect(res.body.audit[0].actor_user_id).toBe(admin.id);
  });
});

describe('POST /api/admin/holdings/:id/override', () => {
  test('trader 403', async () => {
    const { headers: traderHeaders } = createTrader();
    const { consumer } = createConsumer();
    const holdingId = seedHolding(consumer.id);
    const res = await request(app)
      .post(`/api/admin/holdings/${holdingId}/override`)
      .set(traderHeaders)
      .send({ new_status: 'forfeited' });
    expect(res.status).toBe(403);
  });

  test('400 for invalid status', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    const holdingId = seedHolding(consumer.id);
    const res = await request(app)
      .post(`/api/admin/holdings/${holdingId}/override`)
      .set(headers)
      .send({ new_status: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('400 for refunded without destination', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    const holdingId = seedHolding(consumer.id, { status: 'held' });
    const res = await request(app)
      .post(`/api/admin/holdings/${holdingId}/override`)
      .set(headers)
      .send({ new_status: 'refunded' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/destination/i);
  });

  test('404 for missing holding', async () => {
    const { headers } = createAdmin();
    const res = await request(app)
      .post(`/api/admin/holdings/99999/override`)
      .set(headers)
      .send({ new_status: 'held' });
    expect(res.status).toBe(404);
  });

  test('happy path: held → forfeited stamps resolved fields', async () => {
    const { headers, user: admin } = createAdmin();
    const { consumer } = createConsumer();
    const holdingId = seedHolding(consumer.id, { status: 'held' });

    const res = await request(app)
      .post(`/api/admin/holdings/${holdingId}/override`)
      .set(headers)
      .send({ new_status: 'forfeited', notes: 'damaged' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.beforeStatus).toBe('held');
    expect(res.body.afterStatus).toBe('forfeited');

    const h = db.prepare('SELECT * FROM container_holdings WHERE id=?').get(holdingId);
    expect(h.status).toBe('forfeited');
    expect(h.resolved_by).toBe(admin.id);
    expect(h.resolved_at).toBeTruthy();
  });
});
