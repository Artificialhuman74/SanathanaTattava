/**
 * Part 2 — Race conditions & concurrency
 *
 * SQLite + better-sqlite3 is synchronous and serialized per process, so we
 * can't *literally* race two requests. What we CAN test is the protective
 * machinery that would have to hold under a real race:
 *   - idempotency flags on consumer_orders
 *   - the razorpay_webhook_events dedupe table
 *   - the "insufficient stock" guard
 *   - the sweeper's filter predicates
 *
 * Each test simulates the worst-case ordering of events that a real race
 * could produce and asserts the system arrives at the correct state.
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

const {
  deductOrderInventory,
  returnOrderInventory,
} = require('../src/services/inventoryService');
const { sweepAbandonedOrders } = require('../src/services/orderSweeperService');

const RZP_SECRET = 'test-rzp-secret-concurrency';
const WEBHOOK_SECRET = 'test-webhook-secret-concurrency';
const app = createApp();

beforeAll(() => {
  process.env.RAZORPAY_KEY_SECRET     = RZP_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

beforeEach(() => factory.clearAll());

/* ── helpers ─────────────────────────────────────────────────────────────── */

function signVerify(rzpOrderId, rzpPaymentId) {
  return crypto.createHmac('sha256', RZP_SECRET)
    .update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
}

function signWebhook(rawBody) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

function stockOf(dealerId, productId) {
  const row = db.prepare('SELECT quantity FROM dealer_inventory WHERE dealer_id=? AND product_id=?')
    .get(dealerId, productId);
  return row ? row.quantity : 0;
}

function setDealerStock(dealerId, productId, qty) {
  db.prepare(`
    INSERT INTO dealer_inventory (dealer_id, product_id, quantity, low_stock_threshold)
    VALUES (?, ?, ?, 5)
    ON CONFLICT(dealer_id, product_id) DO UPDATE SET quantity = ?
  `).run(dealerId, productId, qty, qty);
}

function addItem(orderId, productId, qty, price = 100) {
  db.prepare(`
    INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, productId, qty, price, qty * price);
}

/* ── 2.1 Inventory deduction is idempotent ──────────────────────────────── */
describe('Inventory deduction idempotency (simulated double-fire)', () => {
  test('deductOrderInventory called twice → only deducts once', () => {
    const dealer = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 10);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      delivery_dealer_id: dealer.user.id,
      payment_status: 'paid',
    });
    addItem(order.id, product.id, 3);

    const r1 = deductOrderInventory(order.id, dealer.user.id);
    expect(r1.success).toBe(true);
    expect(stockOf(dealer.user.id, product.id)).toBe(7);

    // Second call — flag should short-circuit
    const r2 = deductOrderInventory(order.id, dealer.user.id);
    expect(r2.already_deducted).toBe(true);
    expect(stockOf(dealer.user.id, product.id)).toBe(7); // unchanged
  });

  test('Second order for the same dealer cannot deduct below zero', () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 5);

    const consumer = factory.createConsumer();

    const o1 = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id, payment_status: 'paid',
    });
    const o2 = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id, payment_status: 'paid',
    });
    addItem(o1.id, product.id, 3);
    addItem(o2.id, product.id, 3); // 3 + 3 > 5

    deductOrderInventory(o1.id, dealer.user.id);
    expect(stockOf(dealer.user.id, product.id)).toBe(2);

    expect(() => deductOrderInventory(o2.id, dealer.user.id))
      .toThrow(/Insufficient dealer stock/i);
    expect(stockOf(dealer.user.id, product.id)).toBe(2); // unchanged after failed call

    // The failed deduction must NOT have flipped the inventory_deducted flag
    const o2row = db.prepare('SELECT inventory_deducted FROM consumer_orders WHERE id=?').get(o2.id);
    expect(o2row.inventory_deducted).toBe(0);
  });
});

/* ── 2.2 Inventory restore is idempotent ────────────────────────────────── */
describe('Inventory restore idempotency', () => {
  test('returnOrderInventory called twice → only restores once', () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 10);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id, payment_status: 'paid',
    });
    addItem(order.id, product.id, 4);
    deductOrderInventory(order.id, dealer.user.id);
    expect(stockOf(dealer.user.id, product.id)).toBe(6);

    const r1 = returnOrderInventory(order.id);
    expect(r1.restored).toBe(true);
    expect(stockOf(dealer.user.id, product.id)).toBe(10);

    const r2 = returnOrderInventory(order.id);
    expect(r2.restored).toBe(false);
    expect(r2.reason).toBe('already_restored');
    expect(stockOf(dealer.user.id, product.id)).toBe(10); // unchanged
  });

  test('Restore on never-deducted order is a safe no-op', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, { payment_status: 'pending' });

    const r = returnOrderInventory(order.id);
    expect(r.restored).toBe(false);
    expect(r.reason).toBe('never_deducted');
  });

  test('Restore on nonexistent order returns order_not_found, does not throw', () => {
    const r = returnOrderInventory(999_999);
    expect(r.success).toBe(false);
    expect(r.reason).toBe('order_not_found');
  });

  test('Restore when fulfilled_by_dealer_id is missing → no_dealer_recorded', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, { payment_status: 'paid' });
    // Simulate corrupted state: flag is set but dealer wasn't recorded
    db.prepare(`UPDATE consumer_orders SET inventory_deducted=1, fulfilled_by_dealer_id=NULL WHERE id=?`).run(order.id);

    const r = returnOrderInventory(order.id);
    expect(r.success).toBe(false);
    expect(r.reason).toBe('no_dealer_recorded');
  });

  test('Cancel + refund + webhook all firing on the same order → restores exactly once', () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 20);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id, payment_status: 'paid',
    });
    addItem(order.id, product.id, 6);
    deductOrderInventory(order.id, dealer.user.id);
    expect(stockOf(dealer.user.id, product.id)).toBe(14);

    // simulate the three handlers racing
    returnOrderInventory(order.id);
    returnOrderInventory(order.id);
    returnOrderInventory(order.id);

    expect(stockOf(dealer.user.id, product.id)).toBe(20); // back to original, NOT 32 or 26
  });
});

/* ── 2.3 Webhook event-id dedupe ─────────────────────────────────────────── */
describe('Webhook idempotency (event-id dedupe)', () => {
  function postWebhook(event, eventId) {
    const raw = JSON.stringify(event);
    return request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhook(raw))
      .set('x-razorpay-event-id', eventId)
      .send(raw);
  }

  test('Same event_id delivered twice → second is a no-op', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending', total_amount: 500,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_order_id=? WHERE id=?')
      .run('order_evt_dup', order.id);

    const evt = {
      event: 'payment.captured',
      created_at: 1700000000,
      payload: { payment: { entity: { id: 'pay_dup_1', order_id: 'order_evt_dup' } } },
    };

    const r1 = await postWebhook(evt, 'evt_dup_001');
    expect(r1.status).toBe(200);
    expect(r1.body.duplicate).toBeUndefined();

    const r2 = await postWebhook(evt, 'evt_dup_001');
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);

    // Only one row stored in the dedupe table
    const count = db.prepare(`SELECT COUNT(*) as c FROM razorpay_webhook_events WHERE event_id=?`).get('evt_dup_001').c;
    expect(count).toBe(1);
  });

  test('payment.failed → returnOrderInventory called, replay does NOT double-restore', async () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 10);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id,
      payment_status: 'pending', total_amount: 200,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_order_id=? WHERE id=?').run('order_fail_x', order.id);
    addItem(order.id, product.id, 4);
    deductOrderInventory(order.id, dealer.user.id);
    expect(stockOf(dealer.user.id, product.id)).toBe(6);

    const evt = {
      event: 'payment.failed',
      created_at: 1700000001,
      payload: { payment: { entity: { id: 'pay_fail_1', order_id: 'order_fail_x' } } },
    };
    const r1 = await postWebhook(evt, 'evt_fail_001');
    expect(r1.status).toBe(200);
    expect(stockOf(dealer.user.id, product.id)).toBe(10); // restored

    // Replay
    const r2 = await postWebhook(evt, 'evt_fail_001');
    expect(r2.body.duplicate).toBe(true);
    expect(stockOf(dealer.user.id, product.id)).toBe(10); // still 10, not 14
  });

  test('payment.captured replayed → commissions inserted exactly once', async () => {
    const dealer  = factory.createTrader({ tier: 1 });
    db.prepare('UPDATE users SET commission_rate=10 WHERE id=?').run(dealer.user.id);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, payment_status: 'pending', total_amount: 1000,
    });

    // Pay the order via verify (this is where commissions are inserted)
    const rzpOrderId   = 'order_cap_1';
    const rzpPaymentId = 'pay_cap_1';
    await request(app)
      .post('/api/payments/verify')
      .set(consumer.headers)
      .send({
        razorpay_order_id:   rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        razorpay_signature:  signVerify(rzpOrderId, rzpPaymentId),
        consumer_order_id:   order.id,
      });

    const before = db.prepare('SELECT COUNT(*) c FROM commissions WHERE consumer_order_id=?').get(order.id).c;
    expect(before).toBe(1);

    // Now hit the webhook for the same payment, twice.
    const evt = {
      event: 'payment.captured',
      created_at: 1700000002,
      payload: { payment: { entity: { id: rzpPaymentId, order_id: rzpOrderId } } },
    };
    await postWebhook(evt, 'evt_cap_001');
    await postWebhook(evt, 'evt_cap_001');

    const after = db.prepare('SELECT COUNT(*) c FROM commissions WHERE consumer_order_id=?').get(order.id).c;
    expect(after).toBe(1); // webhook is a safety net, not a duplicator
  });
});

/* ── 2.4 Sweeper filters & idempotency ───────────────────────────────────── */
describe('Abandoned-order sweeper', () => {
  test('Sweeper cancels stale pending orders and restores their inventory', () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 10);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id,
      payment_status: 'pending', status: 'pending', total_amount: 100,
    });
    addItem(order.id, product.id, 3);
    deductOrderInventory(order.id, dealer.user.id);
    expect(stockOf(dealer.user.id, product.id)).toBe(7);

    // Age it past the staleness threshold
    db.prepare(`UPDATE consumer_orders SET created_at = datetime('now','-2 hours') WHERE id=?`).run(order.id);

    const result = sweepAbandonedOrders({ staleMinutes: 30 });
    expect(result.cancelled).toBe(1);
    expect(result.restored).toBe(1);

    const row = db.prepare('SELECT status FROM consumer_orders WHERE id=?').get(order.id);
    expect(row).toBeUndefined(); // abandoned orders are deleted, not marked cancelled
    expect(stockOf(dealer.user.id, product.id)).toBe(10); // restored
  });

  test('Sweeper leaves recent pending orders alone', () => {
    const consumer = factory.createConsumer();
    const fresh = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending', status: 'pending',
    });
    const result = sweepAbandonedOrders({ staleMinutes: 30 });
    expect(result.cancelled).toBe(0);
    expect(db.prepare('SELECT status FROM consumer_orders WHERE id=?').get(fresh.id).status)
      .toBe('pending');
  });

  test('Sweeper does NOT cancel paid orders, even if very old', () => {
    const consumer = factory.createConsumer();
    const paid = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', status: 'confirmed',
    });
    db.prepare(`UPDATE consumer_orders SET created_at = datetime('now','-3 days') WHERE id=?`).run(paid.id);

    const result = sweepAbandonedOrders({ staleMinutes: 30 });
    expect(result.cancelled).toBe(0);
    expect(db.prepare('SELECT status FROM consumer_orders WHERE id=?').get(paid.id).status)
      .toBe('confirmed');
  });

  test('Sweeper picks up payment_status=failed orders too', () => {
    const consumer = factory.createConsumer();
    const failed = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'failed', status: 'pending',
    });
    db.prepare(`UPDATE consumer_orders SET created_at = datetime('now','-45 minutes') WHERE id=?`).run(failed.id);

    const result = sweepAbandonedOrders({ staleMinutes: 30 });
    expect(result.cancelled).toBe(1);
    expect(db.prepare('SELECT id FROM consumer_orders WHERE id=?').get(failed.id))
      .toBeUndefined();
  });

  test('Running the sweeper twice on the same stale order is safe', () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    setDealerStock(dealer.user.id, product.id, 10);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id,
      payment_status: 'pending', status: 'pending',
    });
    addItem(order.id, product.id, 2);
    deductOrderInventory(order.id, dealer.user.id);
    db.prepare(`UPDATE consumer_orders SET created_at = datetime('now','-1 hour') WHERE id=?`).run(order.id);

    const r1 = sweepAbandonedOrders({ staleMinutes: 30 });
    const r2 = sweepAbandonedOrders({ staleMinutes: 30 });

    expect(r1.cancelled).toBe(1);
    expect(r2.cancelled).toBe(0); // already removed
    expect(stockOf(dealer.user.id, product.id)).toBe(10); // restored, not over-restored
  });
});
