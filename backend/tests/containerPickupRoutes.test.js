/**
 * Delivery Container Pickup Routes — Phase 6
 *
 *   GET  /api/delivery/container-pickups
 *   POST /api/delivery/container-pickups/:id/resolve
 *
 * Auth: trader (linked dealer) or admin. Other traders are FORBIDDEN.
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createConsumer, createProduct, createTrader, createAdmin,
} = require('./helpers/factory');
const {
  createHoldingsForInvoice, markHoldingsDelivered, requestRefund,
} = require('../src/services/containerHoldingsService');

const app = createApp();

function makeInvoice(orderId, consumer) {
  const r = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_name, customer_email,
      items_json, taxable_amount, total_amount, container_deposit, invoice_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tax')
  `).run(
    `INV-PK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderId, consumer.name, consumer.email || null,
    JSON.stringify([]), 0, 0, 0
  );
  return r.lastInsertRowid;
}

function makeOrderAndItems(consumerId, items) {
  const num = `ORD-PK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function setupRefundRequested({ destination = 'store_credit', linkedDealerId = null } = {}) {
  const { consumer } = createConsumer({ linked_dealer_id: linkedDealerId });
  const p = createProduct({ name: 'Sunflower 2.8L' });
  db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
  const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 1, container_cost: 150 }]);
  const invoiceId = makeInvoice(orderId, consumer);
  createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
  markHoldingsDelivered(orderId);
  const holding = db.prepare(`SELECT * FROM container_holdings WHERE consumer_id=?`).get(consumer.id);
  requestRefund({ holdingId: holding.id, consumerId: consumer.id, destination });
  return { consumer, holding };
}

beforeEach(() => clearAll());

describe('GET /api/delivery/container-pickups', () => {
  test('requires auth', async () => {
    const res = await request(app).get('/api/delivery/container-pickups');
    expect(res.status).toBe(401);
  });

  test('trader sees own consumers only', async () => {
    const t1 = createTrader();
    const t2 = createTrader();
    setupRefundRequested({ linkedDealerId: t1.user.id });
    setupRefundRequested({ linkedDealerId: t2.user.id });
    const res = await request(app).get('/api/delivery/container-pickups').set(t1.headers);
    expect(res.status).toBe(200);
    expect(res.body.pickups).toHaveLength(1);
  });

  test('admin sees all open pickups', async () => {
    const t1 = createTrader();
    const t2 = createTrader();
    const admin = createAdmin();
    setupRefundRequested({ linkedDealerId: t1.user.id });
    setupRefundRequested({ linkedDealerId: t2.user.id });
    const res = await request(app).get('/api/delivery/container-pickups').set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body.pickups).toHaveLength(2);
  });
});

describe('POST /api/delivery/container-pickups/:id/resolve', () => {
  test('linked dealer refunds → status=refunded', async () => {
    const dealer = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    const res = await request(app)
      .post(`/api/delivery/container-pickups/${holding.id}/resolve`)
      .set(dealer.headers)
      .send({ outcome: 'refunded' });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('refunded');
  });

  test('another trader is forbidden', async () => {
    const dealer = createTrader();
    const intruder = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    const res = await request(app)
      .post(`/api/delivery/container-pickups/${holding.id}/resolve`)
      .set(intruder.headers)
      .send({ outcome: 'refunded' });
    expect(res.status).toBe(403);
  });

  test('rejects invalid outcome', async () => {
    const dealer = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    const res = await request(app)
      .post(`/api/delivery/container-pickups/${holding.id}/resolve`)
      .set(dealer.headers)
      .send({ outcome: 'maybe' });
    expect(res.status).toBe(400);
  });

  test('forfeited path persists status and notes', async () => {
    const dealer = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    const res = await request(app)
      .post(`/api/delivery/container-pickups/${holding.id}/resolve`)
      .set(dealer.headers)
      .send({ outcome: 'forfeited', notes: 'cracked lid' });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('forfeited');
    expect(row.notes).toBe('cracked lid');
  });
});
