/**
 * Part 6 — Razorpay webhook
 *
 * The most chaotic surface in the system. Razorpay can deliver:
 *   - duplicate events (network retries)
 *   - out-of-order events (captured before verify, refund before capture)
 *   - events for orders we don't know about (test mode bleed, manual triggers)
 *   - events with tampered bodies / wrong signatures (anyone can POST)
 *
 * All of these must produce 200 (or 400 for invalid signature) without
 * crashing, double-crediting, or losing data. This file exhaustively pokes
 * the webhook surface; concurrency.test.js covers the event-id dedupe path.
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

const WEBHOOK_SECRET = 'test-webhook-secret-part6';
const app = createApp();

beforeAll(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

beforeEach(() => {
  factory.clearAll();
  // Dedupe table is NOT touched by clearAll — wipe per-test so event ids
  // can be reused freely across tests in the same worker.
  db.prepare('DELETE FROM razorpay_webhook_events').run();
});

function signWebhook(rawBody, secret = WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/* Sends a webhook with the canonical signed-body pattern. Pass `rawOverride`
 * to test cases where the body that's *signed* differs from the body that's
 * *sent* (tampered-payload scenarios). */
function postWebhook({ event, eventId, signature, omitSignature, rawOverride }) {
  const raw = JSON.stringify(event);
  const sig = signature !== undefined ? signature : signWebhook(raw);
  const req = request(app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json');
  if (!omitSignature) req.set('x-razorpay-signature', sig);
  if (eventId)        req.set('x-razorpay-event-id', eventId);
  return req.send(rawOverride !== undefined ? rawOverride : raw);
}

/* ── 6.1 Signature verification ──────────────────────────────────────── */
describe('Webhook signature verification', () => {
  test('Missing x-razorpay-signature → 400', async () => {
    const evt = {
      event: 'payment.captured',
      created_at: 1700000000,
      payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_sig_missing', omitSignature: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  test('Bad signature → 400', async () => {
    const evt = {
      event: 'payment.captured',
      created_at: 1700000000,
      payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } },
    };
    const res = await postWebhook({
      event: evt,
      eventId: 'evt_sig_bad',
      signature: 'deadbeef'.repeat(8), // 64 hex chars, but wrong
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  test('Signature computed with a different secret → 400', async () => {
    const evt = {
      event: 'payment.captured',
      created_at: 1700000000,
      payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } },
    };
    const raw = JSON.stringify(evt);
    const res = await postWebhook({
      event: evt,
      eventId: 'evt_sig_wrong_secret',
      signature: signWebhook(raw, 'totally-different-secret'),
    });
    expect(res.status).toBe(400);
  });

  test('Webhook body modified after signing → 400', async () => {
    const evt = {
      event: 'payment.captured',
      created_at: 1700000000,
      payload: { payment: { entity: { id: 'pay_orig', order_id: 'order_orig' } } },
    };
    const signedRaw = JSON.stringify(evt);
    // Tamper: change the order_id after signing
    const tampered = signedRaw.replace('order_orig', 'order_tampered');
    expect(tampered).not.toBe(signedRaw); // sanity

    const res = await postWebhook({
      event: evt,                      // pre-tamper signature
      eventId: 'evt_tampered_body',
      signature: signWebhook(signedRaw),
      rawOverride: tampered,           // send the tampered bytes
    });
    expect(res.status).toBe(400);
    // And: no record of the tampered event ID in the dedupe table
    const row = db.prepare('SELECT 1 FROM razorpay_webhook_events WHERE event_id=?').get('evt_tampered_body');
    expect(row).toBeUndefined();
  });

  test('Missing webhook secret env var → 503 (defensive)', async () => {
    const prev = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      const evt = { event: 'payment.captured', created_at: 0, payload: {} };
      const res = await postWebhook({ event: evt, eventId: 'evt_no_secret' });
      expect(res.status).toBe(503);
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = prev;
    }
  });
});

/* ── 6.2 Unknown / unhandled events ──────────────────────────────────── */
describe('Unknown event types', () => {
  test('Valid signature, unknown event type → 200, no crash, dedupe row written', async () => {
    const evt = {
      event: 'subscription.charged',   // not handled by the switch
      created_at: 1700000100,
      payload: { subscription: { entity: { id: 'sub_1' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_unknown_001' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const row = db.prepare('SELECT event_type FROM razorpay_webhook_events WHERE event_id=?').get('evt_unknown_001');
    expect(row).toBeDefined();
    expect(row.event_type).toBe('subscription.charged');
  });

  test('Valid signature, event with no payload object → 200 (no crash)', async () => {
    const evt = { event: 'order.paid', created_at: 1700000101 };
    const res = await postWebhook({ event: evt, eventId: 'evt_empty_payload' });
    expect(res.status).toBe(200);
  });

  test('Valid signature, body is not JSON → 400', async () => {
    const raw = 'this is not json{{';
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhook(raw))
      .set('x-razorpay-event-id', 'evt_bad_json')
      .send(raw);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });
});

/* ── 6.3 payment.captured ────────────────────────────────────────────── */
describe('payment.captured', () => {
  test('Unknown order_id → 200, no DB mutation', async () => {
    const evt = {
      event: 'payment.captured',
      created_at: 1700000200,
      payload: { payment: { entity: { id: 'pay_ghost', order_id: 'order_does_not_exist' } } },
    };
    const before = db.prepare('SELECT COUNT(*) c FROM consumer_orders').get().c;
    const res = await postWebhook({ event: evt, eventId: 'evt_cap_unknown' });
    expect(res.status).toBe(200);
    const after = db.prepare('SELECT COUNT(*) c FROM consumer_orders').get().c;
    expect(after).toBe(before);
  });

  test('Known order, payment_status=pending → marked paid (safety net)', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending', total_amount: 750,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_order_id=? WHERE id=?')
      .run('order_cap_safety', order.id);

    const evt = {
      event: 'payment.captured',
      created_at: 1700000201,
      payload: { payment: { entity: { id: 'pay_cap_safety', order_id: 'order_cap_safety' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_cap_safety' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT payment_status, status, razorpay_payment_id FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.payment_status).toBe('paid');
    expect(row.status).toBe('confirmed');
    expect(row.razorpay_payment_id).toBe('pay_cap_safety');
  });

  test('Known order already paid → no overwrite, no error', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 500,
    });
    db.prepare(`UPDATE consumer_orders SET razorpay_order_id=?, razorpay_payment_id=? WHERE id=?`)
      .run('order_already_paid', 'pay_original', order.id);

    const evt = {
      event: 'payment.captured',
      created_at: 1700000202,
      payload: { payment: { entity: { id: 'pay_DIFFERENT', order_id: 'order_already_paid' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_cap_already' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT razorpay_payment_id FROM consumer_orders WHERE id=?').get(order.id);
    // Should NOT have been overwritten with the new payment id
    expect(row.razorpay_payment_id).toBe('pay_original');
  });
});

/* ── 6.4 payment.failed ──────────────────────────────────────────────── */
describe('payment.failed', () => {
  test('Marks order failed and triggers returnOrderInventory (idempotent flag)', async () => {
    const dealer  = factory.createTrader({ tier: 1 });
    const product = factory.createProduct();
    // Seed dealer inventory and deduct manually so flag is set
    db.prepare(`
      INSERT INTO dealer_inventory (dealer_id, product_id, quantity, low_stock_threshold)
      VALUES (?, ?, 10, 5)
    `).run(dealer.user.id, product.id);

    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, delivery_dealer_id: dealer.user.id,
      payment_status: 'pending', total_amount: 100,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_order_id=? WHERE id=?')
      .run('order_fail_inv', order.id);
    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total)
      VALUES (?, ?, 3, 100, 300)
    `).run(order.id, product.id);

    const { deductOrderInventory } = require('../src/services/inventoryService');
    deductOrderInventory(order.id, dealer.user.id);

    const stockAfterDeduct = db.prepare('SELECT quantity FROM dealer_inventory WHERE dealer_id=? AND product_id=?')
      .get(dealer.user.id, product.id).quantity;
    expect(stockAfterDeduct).toBe(7);

    const evt = {
      event: 'payment.failed',
      created_at: 1700000300,
      payload: { payment: { entity: { id: 'pay_failed_1', order_id: 'order_fail_inv' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_failed_inv' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT payment_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.payment_status).toBe('failed');

    const stockAfterRestore = db.prepare('SELECT quantity FROM dealer_inventory WHERE dealer_id=? AND product_id=?')
      .get(dealer.user.id, product.id).quantity;
    expect(stockAfterRestore).toBe(10); // restored
  });

  test('Unknown order_id → 200, no crash, no DB write', async () => {
    const evt = {
      event: 'payment.failed',
      created_at: 1700000301,
      payload: { payment: { entity: { id: 'pay_ghost_fail', order_id: 'order_not_in_db' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_failed_unknown' });
    expect(res.status).toBe(200);
  });

  test('payment.failed on order that never had inventory deducted → safe no-op', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending', total_amount: 100,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_order_id=? WHERE id=?')
      .run('order_fail_no_inv', order.id);

    const evt = {
      event: 'payment.failed',
      created_at: 1700000302,
      payload: { payment: { entity: { id: 'pay_no_inv', order_id: 'order_fail_no_inv' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_failed_no_inv' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT payment_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.payment_status).toBe('failed');
  });
});

/* ── 6.5 refund.processed / refund.created ───────────────────────────── */
describe('refund events', () => {
  test('refund.processed updates refund_status on the order matched by payment_id', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 1000,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_payment_id=? WHERE id=?')
      .run('pay_to_refund', order.id);

    const evt = {
      event: 'refund.processed',
      created_at: 1700000400,
      payload: {
        refund: {
          entity: { id: 'rfnd_1', payment_id: 'pay_to_refund', status: 'processed', amount: 100000 }, // 1000.00 in paise
        },
      },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_refund_proc' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT refund_id, refund_status, refund_amount FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.refund_id).toBe('rfnd_1');
    expect(row.refund_status).toBe('processed');
    expect(row.refund_amount).toBeCloseTo(1000.00, 2);
  });

  test('refund.created on the same payment also lands on the correct order', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 200,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_payment_id=? WHERE id=?')
      .run('pay_refund_created', order.id);

    const evt = {
      event: 'refund.created',
      created_at: 1700000401,
      payload: {
        refund: {
          entity: { id: 'rfnd_pending', payment_id: 'pay_refund_created', status: 'pending', amount: 20000 },
        },
      },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_refund_created' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT refund_id, refund_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.refund_id).toBe('rfnd_pending');
    expect(row.refund_status).toBe('pending');
  });

  test('refund.processed for unknown payment_id → 200, no other order touched', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 500,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_payment_id=? WHERE id=?')
      .run('pay_real', order.id);

    const evt = {
      event: 'refund.processed',
      created_at: 1700000402,
      payload: { refund: { entity: { id: 'rfnd_ghost', payment_id: 'pay_nobody', status: 'processed', amount: 1 } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_refund_ghost' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT refund_id FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.refund_id).toBeNull();
  });
});

/* ── 6.6 transfer.processed / transfer.failed ────────────────────────── */
describe('transfer events', () => {
  test('transfer.processed sets commission.status = transferred on matched row only', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, payment_status: 'paid', total_amount: 100,
    });

    const target = db.prepare(`
      INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status, week_start, week_end, razorpay_transfer_id)
      VALUES (?, ?, 10.0, 10, 'direct', 'transferring', '2026-05-18', '2026-05-24', 'trf_target')
    `).run(dealer.user.id, order.id);
    const other = db.prepare(`
      INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status, week_start, week_end, razorpay_transfer_id)
      VALUES (?, ?, 5.0, 5, 'override', 'transferring', '2026-05-18', '2026-05-24', 'trf_other')
    `).run(dealer.user.id, order.id);

    const evt = {
      event: 'transfer.processed',
      created_at: 1700000500,
      payload: { transfer: { entity: { id: 'trf_target' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_transfer_ok' });
    expect(res.status).toBe(200);

    const t = db.prepare('SELECT status FROM commissions WHERE id=?').get(target.lastInsertRowid);
    const o = db.prepare('SELECT status FROM commissions WHERE id=?').get(other.lastInsertRowid);
    expect(t.status).toBe('transferred');
    expect(o.status).toBe('transferring'); // untouched — matched only by transfer_id
  });

  test('transfer.failed sets commission.status = transfer_failed', async () => {
    const dealer = factory.createTrader({ tier: 1 });
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, payment_status: 'paid',
    });

    const ins = db.prepare(`
      INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status, week_start, week_end, razorpay_transfer_id)
      VALUES (?, ?, 12.50, 10, 'direct', 'transferring', '2026-05-18', '2026-05-24', 'trf_will_fail')
    `).run(dealer.user.id, order.id);

    const evt = {
      event: 'transfer.failed',
      created_at: 1700000501,
      payload: { transfer: { entity: { id: 'trf_will_fail' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_transfer_fail' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT status FROM commissions WHERE id=?').get(ins.lastInsertRowid);
    expect(row.status).toBe('transfer_failed');
  });

  test('transfer.processed for unknown transfer_id → 200, no-op', async () => {
    const evt = {
      event: 'transfer.processed',
      created_at: 1700000502,
      payload: { transfer: { entity: { id: 'trf_ghost' } } },
    };
    const res = await postWebhook({ event: evt, eventId: 'evt_transfer_ghost' });
    expect(res.status).toBe(200);

    const any = db.prepare(`SELECT COUNT(*) c FROM commissions WHERE status='transferred'`).get().c;
    expect(any).toBe(0);
  });
});

/* ── 6.7 Replay / dedupe (covered deeper in concurrency.test.js) ─────── */
describe('Event-id dedupe', () => {
  test('Same event_id replayed → second is a duplicate no-op', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'pending', total_amount: 100,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_order_id=? WHERE id=?')
      .run('order_replay_part6', order.id);

    const evt = {
      event: 'payment.captured',
      created_at: 1700000600,
      payload: { payment: { entity: { id: 'pay_replay_p6', order_id: 'order_replay_part6' } } },
    };

    const r1 = await postWebhook({ event: evt, eventId: 'evt_replay_p6' });
    const r2 = await postWebhook({ event: evt, eventId: 'evt_replay_p6' });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);

    const count = db.prepare('SELECT COUNT(*) c FROM razorpay_webhook_events WHERE event_id=?').get('evt_replay_p6').c;
    expect(count).toBe(1);
  });

  test('Replay of refund.processed does not duplicate refund_id update', async () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      payment_status: 'paid', total_amount: 250,
    });
    db.prepare('UPDATE consumer_orders SET razorpay_payment_id=? WHERE id=?')
      .run('pay_refund_replay', order.id);

    const evt = {
      event: 'refund.processed',
      created_at: 1700000601,
      payload: { refund: { entity: { id: 'rfnd_replay', payment_id: 'pay_refund_replay', status: 'processed', amount: 25000 } } },
    };
    await postWebhook({ event: evt, eventId: 'evt_refund_replay' });
    await postWebhook({ event: evt, eventId: 'evt_refund_replay' });

    // refund_amount should remain 250.00 (not 500.00) — dedupe prevented double-write
    const row = db.prepare('SELECT refund_amount FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.refund_amount).toBeCloseTo(250.00, 2);
  });
});
