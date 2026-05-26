/**
 * Consumer Container Routes — Phase 5
 *
 * Covers the consumer-facing My Containers endpoints:
 *   GET  /api/consumer/containers
 *   POST /api/consumer/containers/:id/request-refund
 *   POST /api/consumer/containers/:id/cancel-refund
 *   POST /api/consumer/containers/:id/swap
 *
 * Notification fan-out (admin + linked dealer + email) is asserted at the
 * service level — these tests focus on auth, validation, and state transitions
 * over HTTP.
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createConsumer, createProduct,
  createTrader,
} = require('./helpers/factory');
const {
  createHoldingsForInvoice, markHoldingsDelivered,
} = require('../src/services/containerHoldingsService');

const app = createApp();

function makeInvoice(orderId, consumer) {
  const r = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_name, customer_email,
      items_json, taxable_amount, total_amount, container_deposit, invoice_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tax')
  `).run(
    `INV-RT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderId, consumer.name, consumer.email || null,
    JSON.stringify([]), 0, 0, 0
  );
  return r.lastInsertRowid;
}

function makeOrderAndItems(consumerId, items) {
  const num = `ORD-RT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const or = db.prepare(`
    INSERT INTO consumer_orders
      (order_number, consumer_id, status, payment_status,
       subtotal, discount_percent, discount_amount, total_amount,
       pincode, delivery_address, delivery_status)
    VALUES (?, ?, 'confirmed', 'paid', 0, 0, 0, 0, '560001', 'Test Addr', 'pending')
  `).run(num, consumerId);
  const orderId = or.lastInsertRowid;
  for (const it of items) {
    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, container_cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orderId, it.product_id, it.quantity, it.price || 100, it.quantity * (it.price || 100), it.container_cost || 0);
  }
  return orderId;
}

function setupHeld({ size = '2.8L', extraSizes = [] } = {}) {
  const trader = createTrader();
  const { consumer, headers } = createConsumer({ linked_dealer_id: trader.user.id });
  const product = createProduct({ name: `Oil ${size}` });
  db.prepare(`UPDATE products SET container_type=? WHERE id=?`).run(size, product.id);
  const extras = extraSizes.map((s, i) => {
    const p = createProduct({ name: `Alt ${i} ${s}` });
    db.prepare(`UPDATE products SET container_type=? WHERE id=?`).run(s, p.id);
    return p;
  });
  const orderId   = makeOrderAndItems(consumer.id, [{ product_id: product.id, quantity: 1, container_cost: 150 }]);
  const invoiceId = makeInvoice(orderId, consumer);
  createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
  markHoldingsDelivered(orderId);
  const holding = db.prepare(`SELECT * FROM container_holdings WHERE consumer_id=?`).get(consumer.id);
  return { consumer, headers, product, extras, holding };
}

beforeEach(() => clearAll());

describe('GET /api/consumer/containers', () => {
  test('requires consumer auth', async () => {
    const res = await request(app).get('/api/consumer/containers');
    expect(res.status).toBe(401);
  });

  test('returns held + history + swappable products', async () => {
    const { headers, holding } = setupHeld({ extraSizes: ['2.8L', '5L'] });
    const res = await request(app).get('/api/consumer/containers').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.held).toHaveLength(1);
    expect(res.body.held[0].id).toBe(holding.id);
    expect(res.body.swappable.length).toBeGreaterThanOrEqual(2);
    expect(res.body.swappable.every(p => p.container_type)).toBe(true);
  });
});

const notifyMock = require('../src/services/notificationService');

describe('POST /api/consumer/containers/:id/request-refund', () => {
  beforeEach(() => { notifyMock.notifyContainerRefundRequested.mockClear?.(); });

  test('flips status and fans out via notifyContainerRefundRequested', async () => {
    const { headers, holding, consumer } = setupHeld();
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/request-refund`)
      .set(headers)
      .send({ destination: 'store_credit' });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('refund_requested');
    expect(row.refund_destination).toBe('store_credit');

    /* Verifies the fan-out helper was called with the linked dealer + admin
     * context. Helper-internal email + DB writes are unit-tested separately. */
    expect(notifyMock.notifyContainerRefundRequested).toHaveBeenCalledTimes(1);
    const arg = notifyMock.notifyContainerRefundRequested.mock.calls[0][0];
    expect(arg.linkedDealerId).toBe(consumer.linked_dealer_id);
    expect(arg.destination).toBe('store_credit');
    expect(arg.holdingId).toBe(holding.id);
  });

  test('rejects invalid destination', async () => {
    const { headers, holding } = setupHeld();
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/request-refund`)
      .set(headers)
      .send({ destination: 'crypto' });
    expect(res.status).toBe(400);
  });

  test("rejects another consumer's holding", async () => {
    const { holding } = setupHeld();
    const { headers: otherHeaders } = createConsumer();
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/request-refund`)
      .set(otherHeaders)
      .send({ destination: 'manual_bank' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/consumer/containers/:id/cancel-refund', () => {
  test('restores held state', async () => {
    const { headers, holding } = setupHeld();
    await request(app)
      .post(`/api/consumer/containers/${holding.id}/request-refund`)
      .set(headers).send({ destination: 'manual_bank' });
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/cancel-refund`)
      .set(headers).send();
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('held');
  });
});

describe('POST /api/consumer/containers/:id/swap', () => {
  test('same-size swap succeeds', async () => {
    const { headers, holding, extras } = setupHeld({ extraSizes: ['2.8L'] });
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/swap`)
      .set(headers)
      .send({ target_product_id: extras[0].id });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.current_product_id).toBe(extras[0].id);
  });

  test('cross-size swap is rejected', async () => {
    const { headers, holding, extras } = setupHeld({ extraSizes: ['5L'] });
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/swap`)
      .set(headers)
      .send({ target_product_id: extras[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/container_type mismatch/);
  });
});
