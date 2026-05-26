/**
 * Store Credit Service Tests — Phase 7
 *
 * Verifies:
 *   - getBalance sums append-only ledger
 *   - getAvailableBalance subtracts reserved (unpaid orders)
 *   - applyStoreCredit validates amount > 0 and amount <= balance
 *   - getPendingManualRefunds lists only refunded+manual_bank with no UTR
 *   - settleManualRefund validates UTR length, status, and refuses double-settle
 */

const db = require('../src/database/db');
const storeCredit = require('../src/services/storeCreditService');
const { clearAll, createConsumer, createAdmin, createTrader, createProduct } = require('./helpers/factory');

function seedInvoiceAndProduct(consumerId) {
  const product = createProduct({ container_type: '5L' });
  const orderRow = db.prepare(`
    INSERT INTO consumer_orders
      (order_number, consumer_id, status, payment_status,
       subtotal, total_amount, pincode, delivery_address, delivery_status)
    VALUES (?, ?, 'paid', 'paid', 100, 100, '560001', 'addr', 'pending')
  `).run(`SC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, consumerId);
  const orderId = orderRow.lastInsertRowid;

  const itemRow = db.prepare(`
    INSERT INTO consumer_order_items
      (order_id, product_id, quantity, price, total, container_cost)
    VALUES (?, ?, 1, 100, 100, 100)
  `).run(orderId, product.id);

  const invRow = db.prepare(`
    INSERT INTO invoices
      (invoice_number, order_id, customer_name, items_json, taxable_amount,
       total_amount, container_deposit, invoice_type)
    VALUES (?, ?, 'x', '[]', 0, 0, 0, 'tax')
  `).run(`INV-SC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, orderId);

  return { invoiceId: invRow.lastInsertRowid, orderItemId: itemRow.lastInsertRowid, productId: product.id };
}

function seedLedger(consumerId, rows) {
  for (const r of rows) {
    db.prepare(`
      INSERT INTO consumer_store_credit_ledger
        (consumer_id, delta, reason, source_type, source_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(consumerId, r.delta, r.reason || 'test', r.source_type || 'test', r.source_id || null, r.created_by || null);
  }
}

function seedHolding(consumerId, overrides = {}) {
  const refs = seedInvoiceAndProduct(consumerId);
  const r = db.prepare(`
    INSERT INTO container_holdings
      (invoice_id, order_item_id, original_product_id, current_product_id,
       consumer_id, container_type, deposit_amount, status,
       refund_destination, resolved_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    refs.invoiceId,
    refs.orderItemId,
    refs.productId,
    refs.productId,
    consumerId,
    overrides.container_type || '5L',
    overrides.deposit_amount || 100,
    overrides.status || 'refunded',
    overrides.refund_destination === null ? null : (overrides.refund_destination || 'manual_bank'),
    overrides.resolved_at === null ? null : (overrides.resolved_at || new Date().toISOString()),
    overrides.notes || null,
  );
  return r.lastInsertRowid;
}

beforeEach(() => clearAll());

describe('getBalance / getAvailableBalance', () => {
  test('empty ledger → 0', () => {
    const { consumer } = createConsumer();
    expect(storeCredit.getBalance(consumer.id)).toBe(0);
    expect(storeCredit.getAvailableBalance(consumer.id)).toBe(0);
  });

  test('sums positive and negative deltas', () => {
    const { consumer } = createConsumer();
    seedLedger(consumer.id, [
      { delta: 100, source_type: 'container_refund' },
      { delta: 50,  source_type: 'container_refund' },
      { delta: -30, source_type: 'order_redemption' },
    ]);
    expect(storeCredit.getBalance(consumer.id)).toBe(120);
  });

  test('getAvailableBalance subtracts reserved on unpaid orders', () => {
    const { consumer } = createConsumer();
    seedLedger(consumer.id, [{ delta: 200, source_type: 'container_refund' }]);
    // Unpaid order reserving 80
    db.prepare(`
      INSERT INTO consumer_orders
        (order_number, consumer_id, status, payment_status,
         subtotal, total_amount, store_credit_applied, pincode, delivery_address, delivery_status)
      VALUES ('R1', ?, 'pending', 'pending', 100, 100, 80, '560001', 'addr', 'pending')
    `).run(consumer.id);
    // Cancelled order — should NOT count as reserved
    db.prepare(`
      INSERT INTO consumer_orders
        (order_number, consumer_id, status, payment_status,
         subtotal, total_amount, store_credit_applied, pincode, delivery_address, delivery_status)
      VALUES ('R2', ?, 'cancelled', 'pending', 100, 100, 50, '560001', 'addr', 'pending')
    `).run(consumer.id);
    expect(storeCredit.getBalance(consumer.id)).toBe(200);
    expect(storeCredit.getAvailableBalance(consumer.id)).toBe(120);
  });

  test('available never goes negative', () => {
    const { consumer } = createConsumer();
    // No ledger, but a stale reservation lingers
    db.prepare(`
      INSERT INTO consumer_orders
        (order_number, consumer_id, status, payment_status,
         subtotal, total_amount, store_credit_applied, pincode, delivery_address, delivery_status)
      VALUES ('R3', ?, 'pending', 'pending', 100, 100, 99, '560001', 'addr', 'pending')
    `).run(consumer.id);
    expect(storeCredit.getAvailableBalance(consumer.id)).toBe(0);
  });
});

describe('applyStoreCredit', () => {
  test('rejects amount <= 0', () => {
    const { consumer } = createConsumer();
    expect(() => storeCredit.applyStoreCredit({ consumerId: consumer.id, orderId: 1, amount: 0 }))
      .toThrow(/amount/);
    expect(() => storeCredit.applyStoreCredit({ consumerId: consumer.id, orderId: 1, amount: -5 }))
      .toThrow(/amount/);
  });

  test('rejects amount > balance', () => {
    const { consumer } = createConsumer();
    seedLedger(consumer.id, [{ delta: 50 }]);
    expect(() => storeCredit.applyStoreCredit({ consumerId: consumer.id, orderId: 1, amount: 100 }))
      .toThrow(/insufficient/i);
  });

  test('inserts negative ledger row and returns balanceAfter', () => {
    const { consumer } = createConsumer();
    seedLedger(consumer.id, [{ delta: 100 }]);
    const r = storeCredit.applyStoreCredit({ consumerId: consumer.id, orderId: 42, amount: 30 });
    expect(r.ledgerId).toBeGreaterThan(0);
    expect(r.balanceAfter).toBe(70);
    expect(storeCredit.getBalance(consumer.id)).toBe(70);

    const row = db.prepare(`SELECT * FROM consumer_store_credit_ledger WHERE id=?`).get(r.ledgerId);
    expect(row.delta).toBe(-30);
    expect(row.source_type).toBe('order_redemption');
    expect(row.source_id).toBe(42);
  });
});

describe('getLedger', () => {
  test('returns rows in DESC order by id', () => {
    const { consumer } = createConsumer();
    seedLedger(consumer.id, [
      { delta: 10, reason: 'first' },
      { delta: 20, reason: 'second' },
      { delta: 30, reason: 'third' },
    ]);
    const rows = storeCredit.getLedger(consumer.id);
    expect(rows).toHaveLength(3);
    expect(rows[0].reason).toBe('third');
    expect(rows[2].reason).toBe('first');
  });
});

describe('getPendingManualRefunds', () => {
  test('only returns refunded + manual_bank with no UTR', () => {
    const { user: trader } = createTrader();
    const { consumer } = createConsumer({ linked_dealer_id: trader.id });

    const pendingId = seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });
    // store_credit destination — should not appear
    seedHolding(consumer.id, { status: 'refunded', refund_destination: 'store_credit' });
    // already settled — should not appear
    const settledId = seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });
    db.prepare(`UPDATE container_holdings SET manual_refund_utr='UTR999' WHERE id=?`).run(settledId);
    // still held — should not appear
    seedHolding(consumer.id, { status: 'held', refund_destination: null });

    const list = storeCredit.getPendingManualRefunds();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(pendingId);
    expect(list[0].consumer_name).toBe(consumer.name);
    expect(list[0].linked_dealer_name).toBe(trader.name);
  });
});

describe('settleManualRefund', () => {
  test('rejects short UTR', () => {
    expect(() => storeCredit.settleManualRefund({ holdingId: 1, utr: 'abc' })).toThrow(/utr/i);
    expect(() => storeCredit.settleManualRefund({ holdingId: 1, utr: '' })).toThrow(/utr/i);
  });

  test('404 on missing holding', () => {
    expect(() => storeCredit.settleManualRefund({ holdingId: 99999, utr: 'UTR12345' }))
      .toThrow(/not found/i);
  });

  test('refuses when status is not refunded', () => {
    const { consumer } = createConsumer();
    const id = seedHolding(consumer.id, { status: 'held', refund_destination: null });
    let caught;
    try { storeCredit.settleManualRefund({ holdingId: id, utr: 'UTR12345' }); }
    catch (e) { caught = e; }
    expect(caught.code).toBe('INVALID_STATUS');
  });

  test('refuses when destination is store_credit', () => {
    const { consumer } = createConsumer();
    const id = seedHolding(consumer.id, { status: 'refunded', refund_destination: 'store_credit' });
    let caught;
    try { storeCredit.settleManualRefund({ holdingId: id, utr: 'UTR12345' }); }
    catch (e) { caught = e; }
    expect(caught.code).toBe('INVALID_STATUS');
  });

  test('refuses double-settle (ALREADY_SETTLED)', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const id = seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });
    storeCredit.settleManualRefund({ holdingId: id, utr: 'UTR12345', paidByUserId: admin.id });
    let caught;
    try { storeCredit.settleManualRefund({ holdingId: id, utr: 'UTR99999' }); }
    catch (e) { caught = e; }
    expect(caught.code).toBe('ALREADY_SETTLED');
  });

  test('happy path stamps UTR, paid_at, paid_by', () => {
    const { consumer } = createConsumer();
    const { user: admin } = createAdmin();
    const id = seedHolding(consumer.id, { status: 'refunded', refund_destination: 'manual_bank' });
    const r = storeCredit.settleManualRefund({
      holdingId: id, utr: '  UTR12345  ', notes: 'paid via UPI', paidByUserId: admin.id,
    });
    expect(r.ok).toBe(true);
    expect(r.utr).toBe('UTR12345');
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(id);
    expect(row.manual_refund_utr).toBe('UTR12345');
    expect(row.manual_refund_paid_by).toBe(admin.id);
    expect(row.manual_refund_paid_at).toBeTruthy();
    expect(row.notes).toContain('paid via UPI');
  });
});
