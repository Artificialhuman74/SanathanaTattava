/**
 * Phase 9 — Damage dispute, admin UPI verification, driver reimbursement,
 * and container finance log.
 *
 *   POST /api/consumer/containers/:id/dispute
 *   GET  /api/admin/container-deposits/pending-verification
 *   POST /api/admin/container-deposits/holdings/:id/verify-proof
 *   GET  /api/admin/container-deposits/pending-reimbursement
 *   POST /api/admin/container-deposits/holdings/:id/reimburse-driver
 *   GET  /api/admin/damage-disputes
 *   POST /api/admin/damage-disputes/:id/resolve
 *   GET  /api/admin/container-finance/log
 */
const request = require('supertest');
const db = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createConsumer, createProduct, createTrader, createAdmin,
} = require('./helpers/factory');
const {
  createHoldingsForInvoice, markHoldingsDelivered,
  requestRefund, finalizeRefund,
} = require('../src/services/containerHoldingsService');

const app = createApp();

function makeInvoice(orderId, consumer) {
  const r = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_name, customer_email,
      items_json, taxable_amount, total_amount, container_deposit, invoice_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tax')
  `).run(
    `INV-P9-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderId, consumer.name, consumer.email || null,
    JSON.stringify([]), 0, 0, 0
  );
  return r.lastInsertRowid;
}

function makeOrderAndItems(consumerId, items) {
  const num = `ORD-P9-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Build a refund_requested holding ready for delivery-side finalization. */
function setupRefundRequested({ destination = 'manual_bank', linkedDealerId = null } = {}) {
  const { consumer, headers } = createConsumer({ linked_dealer_id: linkedDealerId });
  const p = createProduct({ name: 'Sunflower 2.8L' });
  db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
  const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 1, container_cost: 150 }]);
  const invoiceId = makeInvoice(orderId, consumer);
  createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
  markHoldingsDelivered(orderId);
  const holding = db.prepare(`SELECT * FROM container_holdings WHERE consumer_id=?`).get(consumer.id);
  requestRefund({ holdingId: holding.id, consumerId: consumer.id, destination });
  return { consumer, headers, holding };
}

beforeEach(() => clearAll());

/* ── Consumer dispute flow ───────────────────────────────────────────── */
describe('POST /api/consumer/containers/:id/dispute', () => {
  test('consumer can dispute a forfeited holding within window', async () => {
    const dealer = createTrader();
    const { consumer, headers, holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'forfeited',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
      damagePhotoUrl: '/uploads/damage/p9-test.webp',
      notes: 'cracked',
    });

    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/dispute`)
      .set(headers)
      .send({ notes: 'looked fine when I handed it over' });
    expect(res.status).toBe(200);

    const row = db.prepare(`SELECT damage_dispute_status FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.damage_dispute_status).toBe('open');

    const log = db.prepare(`
      SELECT event_type FROM container_finance_log WHERE holding_id=?
    `).all(holding.id).map(r => r.event_type);
    expect(log).toContain('consumer_opened_dispute');
    // unused capture silences linter
    void consumer;
  });

  test('cannot dispute when status is not forfeited', async () => {
    const dealer = createTrader();
    const { headers, holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    // still refund_requested
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/dispute`)
      .set(headers).send({});
    expect(res.status).toBe(409);
  });

  test('cannot dispute after window closes', async () => {
    const dealer = createTrader();
    const { headers, holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'forfeited',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
    });
    db.prepare(`UPDATE container_holdings SET dispute_deadline = datetime(CURRENT_TIMESTAMP, '-1 hour') WHERE id=?`).run(holding.id);

    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/dispute`)
      .set(headers).send({});
    expect(res.status).toBe(410);
  });

  test('cannot dispute someone else\'s holding', async () => {
    const dealer = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'forfeited',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
    });
    const other = createConsumer();
    const res = await request(app)
      .post(`/api/consumer/containers/${holding.id}/dispute`)
      .set(other.headers).send({});
    expect(res.status).toBe(403);
  });
});

/* ── Admin verify + reimburse flow ───────────────────────────────────── */
describe('Admin UPI verification & driver reimbursement', () => {
  function setupUpiPaidByDriver() {
    const dealer = createTrader();
    const admin  = createAdmin();
    const { consumer, holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'refunded',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
      overrideDestination: 'manual_upi',
      refundProofUrl: '/uploads/proof/p9-test.webp',
    });
    return { dealer, admin, consumer, holding };
  }

  test('verification queue lists UPI refunds awaiting admin approval', async () => {
    const { admin, holding } = setupUpiPaidByDriver();
    const res = await request(app)
      .get('/api/admin/container-deposits/pending-verification')
      .set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body.pending.map(r => r.id)).toContain(holding.id);
  });

  test('admin approves proof → moves to reimbursement queue with total owed', async () => {
    const { admin, holding } = setupUpiPaidByDriver();
    const ok = await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/verify-proof`)
      .set(admin.headers).send({ approved: true });
    expect(ok.status).toBe(200);

    const queue = await request(app)
      .get('/api/admin/container-deposits/pending-reimbursement')
      .set(admin.headers);
    expect(queue.status).toBe(200);
    expect(queue.body.pending.map(r => r.id)).toContain(holding.id);
    expect(queue.body.totalOwedDriver).toBeGreaterThan(0);
  });

  test('admin rejects proof → cleared from verification queue, requires re-upload', async () => {
    const { admin, holding } = setupUpiPaidByDriver();
    const res = await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/verify-proof`)
      .set(admin.headers).send({ approved: false, notes: 'blurry receipt' });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT refund_proof_url, admin_verified_at FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.refund_proof_url).toBeNull();
    expect(row.admin_verified_at).toBeNull();
  });

  test('reimburse-driver blocked before verification', async () => {
    const { admin, holding } = setupUpiPaidByDriver();
    const res = await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/reimburse-driver`)
      .set(admin.headers).send({});
    expect(res.status).toBe(400);
  });

  test('verify → reimburse stamps reimbursed fields + logs driver_reimbursed', async () => {
    const { admin, holding } = setupUpiPaidByDriver();
    await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/verify-proof`)
      .set(admin.headers).send({ approved: true });
    const res = await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/reimburse-driver`)
      .set(admin.headers).send({});
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT driver_reimbursed_at, driver_reimbursed_amount FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.driver_reimbursed_at).not.toBeNull();
    expect(Number(row.driver_reimbursed_amount)).toBe(150);
    const log = db.prepare(`SELECT event_type FROM container_finance_log WHERE holding_id=?`).all(holding.id).map(r => r.event_type);
    expect(log).toEqual(expect.arrayContaining(['driver_upi_paid_consumer', 'admin_verified_upi_proof', 'driver_reimbursed']));
  });
});

/* ── Admin dispute resolution ────────────────────────────────────────── */
describe('POST /api/admin/damage-disputes/:id/resolve', () => {
  async function openDispute() {
    const dealer = createTrader();
    const admin  = createAdmin();
    const { consumer, headers, holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'forfeited',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
    });
    await request(app).post(`/api/consumer/containers/${holding.id}/dispute`).set(headers).send({});
    return { admin, consumer, holding };
  }

  test('upheld resolution flips dispute status and logs the decision', async () => {
    const { admin, holding } = await openDispute();
    const res = await request(app)
      .post(`/api/admin/damage-disputes/${holding.id}/resolve`)
      .set(admin.headers).send({ resolution: 'upheld', notes: 'photo was misleading' });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT damage_dispute_status FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.damage_dispute_status).toBe('upheld');
    const log = db.prepare(`SELECT event_type FROM container_finance_log WHERE holding_id=?`).all(holding.id).map(r => r.event_type);
    expect(log).toContain('admin_dispute_upheld');
  });

  test('rejected resolution leaves forfeit in place', async () => {
    const { admin, holding } = await openDispute();
    const res = await request(app)
      .post(`/api/admin/damage-disputes/${holding.id}/resolve`)
      .set(admin.headers).send({ resolution: 'rejected' });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT status, damage_dispute_status FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('forfeited');
    expect(row.damage_dispute_status).toBe('rejected');
  });
});

/* ── Finance log endpoint ────────────────────────────────────────────── */
describe('GET /api/admin/container-finance/log', () => {
  test('returns events with totals', async () => {
    const dealer = createTrader();
    const admin  = createAdmin();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'refunded',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
      overrideDestination: 'manual_upi',
      refundProofUrl: '/uploads/proof/p9-log.webp',
    });
    await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/verify-proof`)
      .set(admin.headers).send({ approved: true });
    await request(app)
      .post(`/api/admin/container-deposits/holdings/${holding.id}/reimburse-driver`)
      .set(admin.headers).send({});

    const res = await request(app)
      .get('/api/admin/container-finance/log')
      .set(admin.headers);
    expect(res.status).toBe(200);
    const types = res.body.events.map(e => e.event_type);
    expect(types).toEqual(expect.arrayContaining([
      'driver_upi_paid_consumer',
      'admin_verified_upi_proof',
      'driver_reimbursed',
    ]));
    expect(Number(res.body.totals.driver_paid_total)).toBeGreaterThan(0);
    expect(Number(res.body.totals.verified_total)).toBeGreaterThan(0);
  });
});

/* ── Consumer containers response shape ──────────────────────────────── */
describe('GET /api/consumer/containers (Phase 9 fields)', () => {
  test('forfeited holding exposes dispute fields + support_whatsapp_number', async () => {
    const dealer = createTrader();
    const { headers, holding } = setupRefundRequested({ linkedDealerId: dealer.user.id });
    finalizeRefund({
      holdingId: holding.id,
      outcome: 'forfeited',
      resolvedByUserId: dealer.user.id,
      resolvedByRole: 'trader',
      damagePhotoUrl: '/uploads/damage/p9-shape.webp',
    });
    const res = await request(app).get('/api/consumer/containers').set(headers);
    expect(res.status).toBe(200);
    expect(typeof res.body.support_whatsapp_number).toBe('string');
    const hist = res.body.history.find(h => h.id === holding.id);
    expect(hist).toBeTruthy();
    expect(hist.status).toBe('forfeited');
    expect(hist.damage_photo_url).toBe('/uploads/damage/p9-shape.webp');
    expect(hist.dispute_deadline).toBeTruthy();
    expect(hist.damage_dispute_status).toBe('open');
  });
});
