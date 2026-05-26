/**
 * Store Credit at Checkout — integration test
 *
 * Verifies POST /api/consumer/orders honours `store_credit_to_apply`:
 *   - Reduces the Razorpay-payable total_amount
 *   - Persists `store_credit_applied` on the order row
 *   - Caps usage at (gross - 1) so Razorpay always charges ≥ ₹1
 *   - Ignores credit beyond available balance
 *   - Validates non-numeric / negative input
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createConsumer, createProduct, authHeader,
} = require('./helpers/factory');

const app = createApp();

function seedWallet(consumerId, amount) {
  db.prepare(`
    INSERT INTO consumer_store_credit_ledger
      (consumer_id, delta, reason, source_type)
    VALUES (?, ?, 'seed', 'container_refund')
  `).run(consumerId, amount);
}

function seedAddress(consumerId) {
  return db.prepare(`
    INSERT INTO consumer_addresses
      (consumer_id, label, name, phone, address, pincode, latitude, longitude, is_default)
    VALUES (?, 'Home', 'Test', '9876543210', '1 Test St', '560001', 12.9716, 77.5946, 1)
  `).run(consumerId).lastInsertRowid;
}

beforeEach(() => clearAll());

describe('POST /api/consumer/orders with store_credit_to_apply', () => {
  test('reduces total by requested credit', async () => {
    const { consumer, token } = createConsumer();
    seedWallet(consumer.id, 80);
    const addrId  = seedAddress(consumer.id);
    const product = createProduct({ price: 100, stock: 20 });

    const res = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 2 }],
        address_id: addrId,
        store_credit_to_apply: 50,
      });

    expect(res.status).toBe(201);
    // gross = 200, credit = 50, total_amount = 150
    expect(res.body.order.total_amount).toBe(150);
    const row = db.prepare('SELECT store_credit_applied FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(row.store_credit_applied).toBe(50);
  });

  test('clamps to available balance', async () => {
    const { consumer, token } = createConsumer();
    seedWallet(consumer.id, 30);
    const addrId  = seedAddress(consumer.id);
    const product = createProduct({ price: 100, stock: 20 });

    const res = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 2 }],
        address_id: addrId,
        store_credit_to_apply: 200,
      });

    expect(res.status).toBe(201);
    // Only 30 available → total = 200 - 30 = 170
    expect(res.body.order.total_amount).toBe(170);
  });

  test('caps credit at gross - 1 so Razorpay charges ≥ ₹1', async () => {
    const { consumer, token } = createConsumer();
    seedWallet(consumer.id, 10000);
    const addrId  = seedAddress(consumer.id);
    const product = createProduct({ price: 100, stock: 20 });

    const res = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 2 }],
        address_id: addrId,
        store_credit_to_apply: 10000,
      });

    expect(res.status).toBe(201);
    expect(res.body.order.total_amount).toBeGreaterThanOrEqual(1);
    const row = db.prepare('SELECT store_credit_applied, total_amount FROM consumer_orders WHERE id=?').get(res.body.order.id);
    // gross = 200, cap at 199, total_amount = 1
    expect(row.store_credit_applied).toBe(199);
    expect(row.total_amount).toBe(1);
  });

  test('no credit applied when field omitted', async () => {
    const { consumer, token } = createConsumer();
    seedWallet(consumer.id, 50);
    const addrId  = seedAddress(consumer.id);
    const product = createProduct({ price: 100, stock: 20 });

    const res = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        address_id: addrId,
      });

    expect(res.status).toBe(201);
    expect(res.body.order.total_amount).toBe(100);
    const row = db.prepare('SELECT store_credit_applied FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(row.store_credit_applied).toBe(0);
  });

  test('rejects negative store_credit_to_apply', async () => {
    const { consumer, token } = createConsumer();
    const addrId  = seedAddress(consumer.id);
    const product = createProduct({ price: 100, stock: 20 });

    const res = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        address_id: addrId,
        store_credit_to_apply: -10,
      });

    expect(res.status).toBe(400);
  });

  test('respects reserved credit on unpaid orders', async () => {
    const { consumer, token } = createConsumer();
    seedWallet(consumer.id, 100);
    const addrId  = seedAddress(consumer.id);
    const product = createProduct({ price: 100, stock: 20 });

    // First order reserves 60
    const first = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 2 }],
        address_id: addrId,
        store_credit_to_apply: 60,
      });
    expect(first.status).toBe(201);

    // Second order tries to use 60 more — only 40 should be available
    const second = await request(app)
      .post('/api/consumer/orders')
      .set(authHeader(token))
      .send({
        items: [{ product_id: product.id, quantity: 2 }],
        address_id: addrId,
        store_credit_to_apply: 60,
      });
    expect(second.status).toBe(201);
    const row = db.prepare('SELECT store_credit_applied FROM consumer_orders WHERE id=?').get(second.body.order.id);
    expect(row.store_credit_applied).toBe(40);
  });
});
