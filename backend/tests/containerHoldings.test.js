/**
 * Container Holdings Service Tests — Phase 2
 *
 * Verifies:
 *   - createHoldingsForInvoice materialises one row per delivered unit
 *   - It's idempotent (running twice doesn't double-insert)
 *   - Lines without container_cost don't generate holdings
 *   - Products without container_type are skipped with a warning
 *   - markHoldingsDelivered flips pending_delivery → held only
 *   - getRefillCap respects held-only and the cart-reserved offset
 *   - getHeldContainers omits non-held statuses
 */
const db = require('../src/database/db');
const {
  createHoldingsForInvoice, markHoldingsDelivered,
  getHeldContainers, getRefillCap, getAllHoldingsForConsumer,
  requestRefund, cancelRefund, requestSwap,
  finalizeRefund, getPendingPickups, getStoreCreditBalance,
} = require('../src/services/containerHoldingsService');
const {
  clearAll, createConsumer, createProduct, createTrader, createAdmin,
} = require('./helpers/factory');

function makeInvoice(orderId, consumer) {
  const r = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_name, customer_email,
      items_json, taxable_amount, total_amount, container_deposit, invoice_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tax')
  `).run(
    `INV-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderId, consumer.name, consumer.email || null,
    JSON.stringify([]), 0, 0, 0
  );
  return r.lastInsertRowid;
}

function makeOrderAndItems(consumerId, items) {
  const num = `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

beforeEach(() => clearAll());

describe('createHoldingsForInvoice', () => {
  test('materialises one holding per delivered unit', () => {
    const { consumer } = createConsumer();
    const sunflower = createProduct({ name: 'Sunflower 2.8L', price: 600 });
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(sunflower.id);

    const orderId   = makeOrderAndItems(consumer.id, [
      { product_id: sunflower.id, quantity: 5, container_cost: 250 }, // ₹50 per unit
    ]);
    const invoiceId = makeInvoice(orderId, consumer);

    const result = createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    expect(result.created).toBe(5);
    expect(result.skipped).toBe(false);

    const rows = db.prepare(`SELECT * FROM container_holdings WHERE invoice_id=?`).all(invoiceId);
    expect(rows).toHaveLength(5);
    rows.forEach(r => {
      expect(r.status).toBe('pending_delivery');
      expect(r.container_type).toBe('2.8L');
      expect(r.deposit_amount).toBe(50);
      expect(r.consumer_id).toBe(consumer.id);
      expect(r.original_product_id).toBe(sunflower.id);
      expect(r.current_product_id).toBe(sunflower.id);
    });
  });

  test('is idempotent — second run inserts nothing', () => {
    const { consumer } = createConsumer();
    const p = createProduct({ name: 'Coconut 5L' });
    db.prepare(`UPDATE products SET container_type='5L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 2, container_cost: 200 }]);
    const invoiceId = makeInvoice(orderId, consumer);

    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    const r2 = createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    expect(r2.skipped).toBe(true);
    expect(r2.created).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM container_holdings WHERE invoice_id=?`).get(invoiceId).n).toBe(2);
  });

  test('skips lines with no container_cost', () => {
    const { consumer } = createConsumer();
    const p = createProduct({ name: 'Salt 1kg' });
    // container_type NULL — product has no container at all
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 3, container_cost: 0 }]);
    const invoiceId = makeInvoice(orderId, consumer);

    const result = createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    expect(result.created).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM container_holdings`).get().n).toBe(0);
  });

  test('skips lines where product has no container_type even if cost > 0', () => {
    const { consumer } = createConsumer();
    const p = createProduct({ name: 'Untagged oil' });
    // container_cost > 0 but container_type still NULL
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 2, container_cost: 100 }]);
    const invoiceId = makeInvoice(orderId, consumer);

    // Suppress the expected console.warn
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    warn.mockRestore();

    expect(result.created).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM container_holdings`).get().n).toBe(0);
  });
});

describe('markHoldingsDelivered', () => {
  test('flips only pending_delivery rows for that order', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);

    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 3, container_cost: 150 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });

    // Manually pre-mark one row as refund_requested — must not be touched
    const ids = db.prepare(`SELECT id FROM container_holdings WHERE invoice_id=? ORDER BY id`).all(invoiceId);
    db.prepare(`UPDATE container_holdings SET status='refund_requested' WHERE id=?`).run(ids[0].id);

    const result = markHoldingsDelivered(orderId);
    expect(result.flipped).toBe(2);

    const statuses = db.prepare(`SELECT status FROM container_holdings WHERE invoice_id=? ORDER BY id`).all(invoiceId).map(r => r.status);
    expect(statuses).toEqual(['refund_requested', 'held', 'held']);
  });

  test('is safe to call twice', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='5L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 2, container_cost: 200 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    markHoldingsDelivered(orderId);
    const r2 = markHoldingsDelivered(orderId);
    expect(r2.flipped).toBe(0);
  });
});

describe('getRefillCap', () => {
  test('returns held count minus reserved', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 5, container_cost: 250 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    markHoldingsDelivered(orderId);

    expect(getRefillCap({ consumerId: consumer.id, productId: p.id })).toBe(5);
    expect(getRefillCap({ consumerId: consumer.id, productId: p.id, cartReservedQty: 2 })).toBe(3);
    expect(getRefillCap({ consumerId: consumer.id, productId: p.id, cartReservedQty: 10 })).toBe(0);
  });

  test('pending_delivery does NOT count toward refill cap', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 4, container_cost: 200 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    // Holdings are still pending_delivery — refill cap should be 0
    expect(getRefillCap({ consumerId: consumer.id, productId: p.id })).toBe(0);
  });

  test('refund_requested does NOT count', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 3, container_cost: 150 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    markHoldingsDelivered(orderId);
    // Flip one to refund_requested
    const oneId = db.prepare(`SELECT id FROM container_holdings WHERE invoice_id=? LIMIT 1`).get(invoiceId).id;
    db.prepare(`UPDATE container_holdings SET status='refund_requested' WHERE id=?`).run(oneId);

    expect(getRefillCap({ consumerId: consumer.id, productId: p.id })).toBe(2);
  });
});

describe('getHeldContainers', () => {
  test('returns only held rows with product info joined', () => {
    const { consumer } = createConsumer();
    const sunflower = createProduct({ name: 'Sunflower 2.8L' });
    const coconut   = createProduct({ name: 'Coconut 5L' });
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(sunflower.id);
    db.prepare(`UPDATE products SET container_type='5L'   WHERE id=?`).run(coconut.id);

    const orderId = makeOrderAndItems(consumer.id, [
      { product_id: sunflower.id, quantity: 2, container_cost: 100 },
      { product_id: coconut.id,   quantity: 1, container_cost: 100 },
    ]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    markHoldingsDelivered(orderId);

    const held = getHeldContainers(consumer.id);
    expect(held).toHaveLength(3);
    const names = held.map(h => h.current_product_name).sort();
    expect(names).toEqual(['Coconut 5L', 'Sunflower 2.8L', 'Sunflower 2.8L']);
  });

  test('empty for consumer with no holdings', () => {
    const { consumer } = createConsumer();
    expect(getHeldContainers(consumer.id)).toEqual([]);
  });

  test('omits pending_delivery rows (in-transit)', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 2, container_cost: 100 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    // Don't mark delivered
    expect(getHeldContainers(consumer.id)).toEqual([]);
    // But getAllHoldingsForConsumer should still include them for the History tab
    expect(getAllHoldingsForConsumer(consumer.id)).toHaveLength(2);
  });
});

/* ── Phase 5: refund + swap helpers ─────────────────────────────────── */

function setupHeldHolding({ containerType = '2.8L', extraProducts = [] } = {}) {
  const { consumer } = createConsumer();
  const p = createProduct({ name: `Primary ${containerType}` });
  db.prepare(`UPDATE products SET container_type=? WHERE id=?`).run(containerType, p.id);
  const others = extraProducts.map((opts, idx) => {
    const ep = createProduct({ name: `Alt ${idx} ${opts.size || containerType}` });
    db.prepare(`UPDATE products SET container_type=? WHERE id=?`).run(opts.size || containerType, ep.id);
    return ep;
  });
  const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 1, container_cost: 150 }]);
  const invoiceId = makeInvoice(orderId, consumer);
  createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
  markHoldingsDelivered(orderId);
  const holding = db.prepare(`SELECT * FROM container_holdings WHERE consumer_id=? LIMIT 1`).get(consumer.id);
  return { consumer, product: p, others, holding };
}

describe('requestRefund', () => {
  test('flips status to refund_requested and stamps destination', () => {
    const { consumer, holding } = setupHeldHolding();
    requestRefund({
      holdingId: holding.id,
      consumerId: consumer.id,
      destination: 'manual_bank',
      notes: 'pickup any weekend',
    });
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('refund_requested');
    expect(row.refund_destination).toBe('manual_bank');
    expect(row.requested_at).toBeTruthy();
    expect(row.notes).toBe('pickup any weekend');
  });

  test('rejects invalid destination', () => {
    const { consumer, holding } = setupHeldHolding();
    expect(() => requestRefund({
      holdingId: holding.id, consumerId: consumer.id, destination: 'crypto',
    })).toThrow(/invalid refund destination/);
  });

  test("rejects another consumer's holding", () => {
    const { holding } = setupHeldHolding();
    const { consumer: other } = createConsumer();
    expect(() => requestRefund({
      holdingId: holding.id, consumerId: other.id, destination: 'store_credit',
    })).toThrow(/not found/);
  });

  test('cannot refund from pending_delivery', () => {
    const { consumer } = createConsumer();
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 1, container_cost: 150 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    const pending = db.prepare(`SELECT id FROM container_holdings WHERE invoice_id=?`).get(invoiceId);
    expect(() => requestRefund({
      holdingId: pending.id, consumerId: consumer.id, destination: 'manual_bank',
    })).toThrow(/pending_delivery/);
  });
});

describe('cancelRefund', () => {
  test('restores held status and clears destination', () => {
    const { consumer, holding } = setupHeldHolding();
    requestRefund({ holdingId: holding.id, consumerId: consumer.id, destination: 'store_credit' });
    cancelRefund({ holdingId: holding.id, consumerId: consumer.id });
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('held');
    expect(row.refund_destination).toBeNull();
    expect(row.requested_at).toBeNull();
  });

  test('cannot cancel from held (nothing to cancel)', () => {
    const { consumer, holding } = setupHeldHolding();
    expect(() => cancelRefund({
      holdingId: holding.id, consumerId: consumer.id,
    })).toThrow(/held/);
  });
});

describe('requestSwap', () => {
  test('same-size swap reassigns current_product_id and records audit row', () => {
    const { consumer, holding, others } = setupHeldHolding({
      extraProducts: [{ size: '2.8L' }],
    });
    requestSwap({
      holdingId: holding.id,
      consumerId: consumer.id,
      targetProductId: others[0].id,
    });
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.current_product_id).toBe(others[0].id);
    const audit = db.prepare(`SELECT * FROM container_swaps WHERE holding_id=?`).get(holding.id);
    expect(audit).toBeTruthy();
    expect(audit.to_product_id).toBe(others[0].id);
    expect(audit.from_product_id).toBe(holding.current_product_id);
  });

  test('rejects cross-size swap', () => {
    const { consumer, holding, others } = setupHeldHolding({
      extraProducts: [{ size: '5L' }],
    });
    expect(() => requestSwap({
      holdingId: holding.id,
      consumerId: consumer.id,
      targetProductId: others[0].id,
    })).toThrow(/container_type mismatch/);
  });

  test('rejects swap to same product', () => {
    const { consumer, holding } = setupHeldHolding();
    expect(() => requestSwap({
      holdingId: holding.id,
      consumerId: consumer.id,
      targetProductId: holding.current_product_id,
    })).toThrow(/same as current/);
  });

  test('rejects swap from refund_requested', () => {
    const { consumer, holding, others } = setupHeldHolding({
      extraProducts: [{ size: '2.8L' }],
    });
    requestRefund({ holdingId: holding.id, consumerId: consumer.id, destination: 'store_credit' });
    expect(() => requestSwap({
      holdingId: holding.id,
      consumerId: consumer.id,
      targetProductId: others[0].id,
    })).toThrow(/refund_requested/);
  });
});

/* ── Phase 6: finalizeRefund + pickup helpers ───────────────────────── */

function setupRefundRequested({ destination = 'store_credit', linkedDealerId = null } = {}) {
  const { consumer } = createConsumer({ linked_dealer_id: linkedDealerId });
  const p = createProduct({ name: 'Primary 2.8L' });
  db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
  const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 1, container_cost: 150 }]);
  const invoiceId = makeInvoice(orderId, consumer);
  createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
  markHoldingsDelivered(orderId);
  const holding = db.prepare(`SELECT * FROM container_holdings WHERE consumer_id=?`).get(consumer.id);
  requestRefund({ holdingId: holding.id, consumerId: consumer.id, destination });
  return { consumer, holding };
}

describe('finalizeRefund', () => {
  test('linked dealer can mark refunded; store_credit ledger entry is created', () => {
    const { user: dealer } = createTrader();
    const { consumer, holding } = setupRefundRequested({
      destination: 'store_credit', linkedDealerId: dealer.id,
    });
    finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer.id,
      resolvedByRole: 'trader',
      outcome: 'refunded',
    });
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('refunded');
    expect(row.resolved_by).toBe(dealer.id);
    expect(getStoreCreditBalance(consumer.id)).toBe(150);
  });

  test('manual_bank refund does NOT insert ledger row', () => {
    const { user: dealer } = createTrader();
    const { consumer, holding } = setupRefundRequested({
      destination: 'manual_bank', linkedDealerId: dealer.id,
    });
    finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer.id,
      resolvedByRole: 'trader',
      outcome: 'refunded',
    });
    expect(getStoreCreditBalance(consumer.id)).toBe(0);
  });

  test('forfeited never credits store credit even when destination=store_credit', () => {
    const { user: dealer } = createTrader();
    const { consumer, holding } = setupRefundRequested({
      destination: 'store_credit', linkedDealerId: dealer.id,
    });
    finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer.id,
      resolvedByRole: 'trader',
      outcome: 'forfeited',
      notes: 'lid cracked',
    });
    const row = db.prepare(`SELECT * FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('forfeited');
    expect(row.notes).toBe('lid cracked');
    expect(getStoreCreditBalance(consumer.id)).toBe(0);
  });

  test('admin can override and finalize any pickup', () => {
    const { user: dealer } = createTrader();
    const { user: admin } = createAdmin();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.id });
    finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: admin.id,
      resolvedByRole: 'admin',
      outcome: 'refunded',
    });
    const row = db.prepare(`SELECT status FROM container_holdings WHERE id=?`).get(holding.id);
    expect(row.status).toBe('refunded');
  });

  test('non-linked dealer is forbidden', () => {
    const { user: dealer1 } = createTrader();
    const { user: dealer2 } = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer1.id });
    expect(() => finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer2.id,
      resolvedByRole: 'trader',
      outcome: 'refunded',
    })).toThrow(/only the linked dealer/);
  });

  test('cannot finalize when status is not refund_requested', () => {
    const { user: dealer } = createTrader();
    const { consumer } = createConsumer({ linked_dealer_id: dealer.id });
    const p = createProduct();
    db.prepare(`UPDATE products SET container_type='2.8L' WHERE id=?`).run(p.id);
    const orderId   = makeOrderAndItems(consumer.id, [{ product_id: p.id, quantity: 1, container_cost: 150 }]);
    const invoiceId = makeInvoice(orderId, consumer);
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: consumer.id });
    markHoldingsDelivered(orderId);
    const holding = db.prepare(`SELECT id FROM container_holdings WHERE consumer_id=?`).get(consumer.id);
    expect(() => finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer.id,
      resolvedByRole: 'trader',
      outcome: 'refunded',
    })).toThrow(/held/);
  });

  test('rejects invalid outcome', () => {
    const { user: dealer } = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.id });
    expect(() => finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer.id,
      resolvedByRole: 'trader',
      outcome: 'maybe',
    })).toThrow(/invalid outcome/);
  });
});

describe('getPendingPickups', () => {
  test('trader sees only own consumers; admin sees all', () => {
    const { user: dealer1 } = createTrader();
    const { user: dealer2 } = createTrader();
    const { user: admin } = createAdmin();
    setupRefundRequested({ linkedDealerId: dealer1.id });
    setupRefundRequested({ linkedDealerId: dealer2.id });

    const list1 = getPendingPickups({ userId: dealer1.id, role: 'trader' });
    const list2 = getPendingPickups({ userId: dealer2.id, role: 'trader' });
    const listAdmin = getPendingPickups({ userId: admin.id, role: 'admin' });

    expect(list1).toHaveLength(1);
    expect(list2).toHaveLength(1);
    expect(listAdmin).toHaveLength(2);
  });

  test('excludes already-resolved holdings', () => {
    const { user: dealer } = createTrader();
    const { holding } = setupRefundRequested({ linkedDealerId: dealer.id });
    finalizeRefund({
      holdingId: holding.id,
      resolvedByUserId: dealer.id,
      resolvedByRole: 'trader',
      outcome: 'refunded',
    });
    expect(getPendingPickups({ userId: dealer.id, role: 'trader' })).toHaveLength(0);
  });
});
