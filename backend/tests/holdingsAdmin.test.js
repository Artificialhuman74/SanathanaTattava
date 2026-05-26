/**
 * Phase 8 — admin holdings service tests.
 *
 * Covers listAllHoldings filters, getHoldingDetail audit join,
 * and adminOverrideHolding ledger reconciliation.
 */

const db = require('../src/database/db');
const holdings = require('../src/services/containerHoldingsService');
const storeCredit = require('../src/services/storeCreditService');
const { clearAll, createConsumer, createAdmin, createProduct } = require('./helpers/factory');

function seedHolding(consumerId, overrides = {}) {
  const product = createProduct({ container_type: overrides.container_type || '5L' });

  const orderRow = db.prepare(`
    INSERT INTO consumer_orders
      (order_number, consumer_id, status, payment_status,
       subtotal, total_amount, pincode, delivery_address, delivery_status)
    VALUES (?, ?, 'paid', 'paid', 100, 100, '560001', 'addr', 'pending')
  `).run(`HOLD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, consumerId);
  const orderId = orderRow.lastInsertRowid;

  const itemRow = db.prepare(`
    INSERT INTO consumer_order_items
      (order_id, product_id, quantity, price, total, container_cost)
    VALUES (?, ?, 1, 100, 100, ?)
  `).run(orderId, product.id, overrides.deposit_amount || 100);

  const invRow = db.prepare(`
    INSERT INTO invoices
      (invoice_number, order_id, customer_name, items_json, taxable_amount,
       total_amount, container_deposit, invoice_type)
    VALUES (?, ?, 'x', '[]', 0, 0, 0, 'tax')
  `).run(`INV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, orderId);

  const hRow = db.prepare(`
    INSERT INTO container_holdings
      (invoice_id, order_item_id, original_product_id, current_product_id,
       consumer_id, container_type, deposit_amount, status,
       refund_destination, resolved_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invRow.lastInsertRowid,
    itemRow.lastInsertRowid,
    product.id,
    product.id,
    consumerId,
    overrides.container_type || '5L',
    overrides.deposit_amount || 100,
    overrides.status || 'held',
    overrides.refund_destination === undefined ? null : overrides.refund_destination,
    overrides.resolved_at || null,
    overrides.notes || null,
  );
  return hRow.lastInsertRowid;
}

beforeEach(() => clearAll());

describe('listAllHoldings', () => {
  test('returns all holdings with status counts when no filters', () => {
    const { consumer } = createConsumer();
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });

    const result = holdings.listAllHoldings();
    expect(result.holdings.length).toBe(3);
    expect(result.statusCounts).toEqual({ held: 2, refunded: 1 });
  });

  test('filters by single status', () => {
    const { consumer } = createConsumer();
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });

    const result = holdings.listAllHoldings({ status: 'held' });
    expect(result.holdings.length).toBe(1);
    expect(result.holdings[0].status).toBe('held');
  });

  test('filters by status array (IN)', () => {
    const { consumer } = createConsumer();
    seedHolding(consumer.id, { status: 'held' });
    seedHolding(consumer.id, { status: 'refund_requested' });
    seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });

    const result = holdings.listAllHoldings({ status: ['held', 'refund_requested'] });
    expect(result.holdings.length).toBe(2);
  });

  test('filters by consumerId', () => {
    const a = createConsumer().consumer;
    const b = createConsumer().consumer;
    seedHolding(a.id, { status: 'held' });
    seedHolding(b.id, { status: 'held' });

    const result = holdings.listAllHoldings({ consumerId: a.id });
    expect(result.holdings.length).toBe(1);
    expect(result.holdings[0].consumer_id).toBe(a.id);
  });

  test('filters by containerType', () => {
    const { consumer } = createConsumer();
    seedHolding(consumer.id, { container_type: '5L' });
    seedHolding(consumer.id, { container_type: '15L' });

    const result = holdings.listAllHoldings({ containerType: '15L' });
    expect(result.holdings.length).toBe(1);
    expect(result.holdings[0].container_type).toBe('15L');
  });

  test('search matches consumer name', () => {
    const { consumer } = createConsumer({ name: 'Alice Wonderland' });
    const { consumer: other } = createConsumer({ name: 'Bob Other' });
    seedHolding(consumer.id);
    seedHolding(other.id);

    const result = holdings.listAllHoldings({ search: 'Alice' });
    expect(result.holdings.length).toBe(1);
    expect(result.holdings[0].consumer_name).toBe('Alice Wonderland');
  });

  test('respects limit/offset', () => {
    const { consumer } = createConsumer();
    seedHolding(consumer.id);
    seedHolding(consumer.id);
    seedHolding(consumer.id);

    const page1 = holdings.listAllHoldings({ limit: 2, offset: 0 });
    const page2 = holdings.listAllHoldings({ limit: 2, offset: 2 });
    expect(page1.holdings.length).toBe(2);
    expect(page2.holdings.length).toBe(1);
  });
});

describe('getHoldingDetail', () => {
  test('returns null when missing', () => {
    expect(holdings.getHoldingDetail(99999)).toBeNull();
  });

  test('returns holding + audit ordered DESC', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id, { status: 'held' });

    holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id,
      newStatus: 'refund_requested', notes: 'first',
    });
    holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id,
      newStatus: 'refunded', newDestination: 'manual_bank', notes: 'second',
    });

    const detail = holdings.getHoldingDetail(holdingId);
    expect(detail.holding.id).toBe(holdingId);
    expect(detail.audit.length).toBe(2);
    expect(detail.audit[0].notes).toBe('second');
    expect(detail.audit[1].notes).toBe('first');
    expect(detail.audit[0].actor_name).toBe(admin.name);
  });
});

describe('adminOverrideHolding — validation', () => {
  test('rejects invalid status', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id);

    expect(() => holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id, newStatus: 'bogus',
    })).toThrow(/invalid status/);
  });

  test('rejects invalid destination', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id);

    expect(() => holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id,
      newStatus: 'refunded', newDestination: 'paypal',
    })).toThrow(/invalid destination/);
  });

  test('rejects refunded without destination', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id);

    expect(() => holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id, newStatus: 'refunded',
    })).toThrow(/refund_destination/);
  });

  test('throws NOT_FOUND for missing holding', () => {
    const { user: admin } = createAdmin();
    expect(() => holdings.adminOverrideHolding({
      holdingId: 99999, actorUserId: admin.id, newStatus: 'held',
    })).toThrow(/not found/);
  });

  test('no-op when status, destination, and notes unchanged', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id, { status: 'held' });

    const result = holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id, newStatus: 'held',
    });
    expect(result).toEqual({ ok: true, noop: true });

    const audit = db.prepare('SELECT COUNT(*) AS n FROM container_holdings_audit WHERE holding_id=?').get(holdingId);
    expect(audit.n).toBe(0);
  });
});

describe('adminOverrideHolding — ledger reconciliation', () => {
  test('held → refunded+store_credit writes positive ledger row + audit', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id, { status: 'held', deposit_amount: 250 });

    holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id,
      newStatus: 'refunded', newDestination: 'store_credit',
      notes: 'consumer requested credit',
    });

    expect(storeCredit.getBalance(consumer.id)).toBe(250);

    const audit = db.prepare('SELECT * FROM container_holdings_audit WHERE holding_id=?').all(holdingId);
    expect(audit.length).toBe(1);
    expect(audit[0].before_status).toBe('held');
    expect(audit[0].after_status).toBe('refunded');
    expect(audit[0].after_destination).toBe('store_credit');

    const h = db.prepare('SELECT * FROM container_holdings WHERE id=?').get(holdingId);
    expect(h.status).toBe('refunded');
    expect(h.resolved_at).toBeTruthy();
    expect(h.resolved_by).toBe(admin.id);
  });

  test('refunded+store_credit → held writes negative ledger row (admin_adjustment)', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id, {
      status: 'refunded', refund_destination: 'store_credit', deposit_amount: 200,
    });
    // Seed the original credit (as if Phase 6 wrote it)
    db.prepare(`
      INSERT INTO consumer_store_credit_ledger
        (consumer_id, delta, reason, source_type, source_id)
      VALUES (?, 200, 'original', 'container_refund', ?)
    `).run(consumer.id, holdingId);
    expect(storeCredit.getBalance(consumer.id)).toBe(200);

    holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id,
      newStatus: 'held', notes: 'mistake — restore holding',
    });

    expect(storeCredit.getBalance(consumer.id)).toBe(0);

    const ledger = db.prepare(`
      SELECT * FROM consumer_store_credit_ledger
       WHERE consumer_id=? ORDER BY id DESC
    `).all(consumer.id);
    expect(ledger[0].delta).toBe(-200);
    expect(ledger[0].source_type).toBe('admin_adjustment');
  });

  test('held → forfeited writes audit only, no ledger entry', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id, { status: 'held', deposit_amount: 100 });

    holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id, newStatus: 'forfeited',
      notes: 'container damaged',
    });

    expect(storeCredit.getBalance(consumer.id)).toBe(0);

    const audit = db.prepare('SELECT * FROM container_holdings_audit WHERE holding_id=?').all(holdingId);
    expect(audit.length).toBe(1);
    expect(audit[0].after_status).toBe('forfeited');

    const h = db.prepare('SELECT * FROM container_holdings WHERE id=?').get(holdingId);
    expect(h.status).toBe('forfeited');
    expect(h.resolved_at).toBeTruthy();
    expect(h.resolved_by).toBe(admin.id);
  });

  test('refunded+manual_bank → refunded+store_credit writes positive ledger row', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const holdingId = seedHolding(consumer.id, {
      status: 'refunded', refund_destination: 'manual_bank', deposit_amount: 150,
    });

    holdings.adminOverrideHolding({
      holdingId, actorUserId: admin.id,
      newStatus: 'refunded', newDestination: 'store_credit',
      notes: 'switching to credit',
    });

    expect(storeCredit.getBalance(consumer.id)).toBe(150);
  });
});
