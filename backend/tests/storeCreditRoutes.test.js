/**
 * Store Credit Route Tests — Phase 7
 *
 *   GET  /api/consumer/store-credit
 *   GET  /api/admin/manual-refunds
 *   POST /api/admin/manual-refunds/:holdingId/settle
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createConsumer, createAdmin, createTrader, createProduct, tokenFor, authHeader,
} = require('./helpers/factory');

const app = createApp();

function seedRefund(consumerId, delta = 100) {
  db.prepare(`
    INSERT INTO consumer_store_credit_ledger
      (consumer_id, delta, reason, source_type, source_id)
    VALUES (?, ?, 'Container refund', 'container_refund', NULL)
  `).run(consumerId, delta);
}

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
       consumer_id, container_type, deposit_amount, status,
       refund_destination, resolved_at)
    VALUES (?, ?, ?, ?, ?, '5L', 100, ?, ?, ?)
  `).run(
    invoiceId, itemId, product.id, product.id, consumerId,
    overrides.status || 'refunded',
    overrides.refund_destination || 'manual_bank',
    overrides.resolved_at || new Date().toISOString(),
  );
  return r.lastInsertRowid;
}

beforeEach(() => clearAll());

describe('GET /api/consumer/store-credit', () => {
  test('requires auth', async () => {
    const res = await request(app).get('/api/consumer/store-credit');
    expect(res.status).toBe(401);
  });

  test('returns balance + ledger for consumer', async () => {
    const { consumer, token } = createConsumer();
    seedRefund(consumer.id, 150);
    seedRefund(consumer.id, 50);

    const res = await request(app)
      .get('/api/consumer/store-credit')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(200);
    expect(res.body.ledger).toHaveLength(2);
    expect(res.body.ledger[0].delta).toBe(50); // most recent first
  });

  test('isolates by consumer', async () => {
    const { consumer: a } = createConsumer();
    const { token: bToken } = createConsumer();
    seedRefund(a.id, 999);

    const res = await request(app)
      .get('/api/consumer/store-credit')
      .set(authHeader(bToken));

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(0);
    expect(res.body.ledger).toHaveLength(0);
  });
});

describe('GET /api/admin/manual-refunds', () => {
  test('requires admin auth', async () => {
    const res = await request(app).get('/api/admin/manual-refunds');
    expect(res.status).toBe(401);
  });

  test('trader gets 403', async () => {
    const { headers } = createTrader();
    const res = await request(app).get('/api/admin/manual-refunds').set(headers);
    expect(res.status).toBe(403);
  });

  test('admin sees pending refunds', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    const id = seedHolding(consumer.id);
    // store_credit destination — excluded
    seedHolding(consumer.id, { refund_destination: 'store_credit' });

    const res = await request(app).get('/api/admin/manual-refunds').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].id).toBe(id);
  });
});

describe('POST /api/admin/manual-refunds/:id/settle', () => {
  test('rejects short UTR with 400', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    const id = seedHolding(consumer.id);

    const res = await request(app)
      .post(`/api/admin/manual-refunds/${id}/settle`)
      .set(headers)
      .send({ utr: 'ab' });

    expect(res.status).toBe(400);
  });

  test('404 on missing holding', async () => {
    const { headers } = createAdmin();
    const res = await request(app)
      .post(`/api/admin/manual-refunds/999999/settle`)
      .set(headers)
      .send({ utr: 'UTR12345' });
    expect(res.status).toBe(404);
  });

  test('happy path stamps UTR, removes from queue', async () => {
    const { user, headers } = createAdmin();
    const { consumer } = createConsumer();
    const id = seedHolding(consumer.id);

    const res = await request(app)
      .post(`/api/admin/manual-refunds/${id}/settle`)
      .set(headers)
      .send({ utr: 'UTRABC12345', notes: 'paid via NEFT' });

    expect(res.status).toBe(200);
    expect(res.body.utr).toBe('UTRABC12345');

    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(id);
    expect(row.manual_refund_utr).toBe('UTRABC12345');
    expect(row.manual_refund_paid_by).toBe(user.id);

    const list = await request(app).get('/api/admin/manual-refunds').set(headers);
    expect(list.body.refunds).toHaveLength(0);
  });

  test('double-settle returns 409', async () => {
    const { headers } = createAdmin();
    const { consumer } = createConsumer();
    const id = seedHolding(consumer.id);
    await request(app)
      .post(`/api/admin/manual-refunds/${id}/settle`)
      .set(headers)
      .send({ utr: 'UTR12345' });

    const res = await request(app)
      .post(`/api/admin/manual-refunds/${id}/settle`)
      .set(headers)
      .send({ utr: 'UTR99999' });
    expect(res.status).toBe(409);
  });

  test('trader is forbidden', async () => {
    const { headers } = createTrader();
    const res = await request(app)
      .post(`/api/admin/manual-refunds/1/settle`)
      .set(headers)
      .send({ utr: 'UTR12345' });
    expect(res.status).toBe(403);
  });
});
