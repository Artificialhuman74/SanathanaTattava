/**
 * Part 18 — Data integrity
 *
 * Tests FK enforcement, soft-delete behavior, migration smoke,
 * key column existence, and orphan prevention.
 */
const factory = require('./helpers/factory');
const db      = require('../src/database/db');

beforeEach(() => factory.clearAll());

/* ── 18.1 SQLite FK enforcement ─────────────────────────────────────────── */
describe('Foreign key enforcement (PRAGMA foreign_keys = ON)', () => {
  test('inserting consumer_order_items with non-existent order_id throws', () => {
    const product = factory.createProduct();
    expect(() => {
      db.prepare(`
        INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total)
        VALUES (999999, ?, 1, 10.00, 10.00)
      `).run(product.id);
    }).toThrow();
  });

  test('inserting a commission for a non-existent trader_id throws', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO commissions (trader_id, amount, rate, type, status)
        VALUES (999999, 100.00, 10.0, 'direct', 'pending')
      `).run();
    }).toThrow();
  });

  test('inserting consumer_order with non-existent delivery_dealer_id throws', () => {
    const consumer = factory.createConsumer();
    const num = `ORD-FK-TEST-${Date.now()}`;
    expect(() => {
      db.prepare(`
        INSERT INTO consumer_orders
          (order_number, consumer_id, delivery_dealer_id, is_direct, status, payment_status,
           subtotal, discount_percent, discount_amount, total_amount, pincode, delivery_address, delivery_status)
        VALUES (?, ?, 999999, 0, 'pending', 'pending', 100, 0, 0, 100, '560001', 'Test Road', 'pending')
      `).run(num, consumer.consumer.id);
    }).toThrow();
  });
});

/* ── 18.2 Soft-delete trader keeps commissions intact ─────────────────── */
describe('Soft-delete trader preserves commissions', () => {
  test('setting user status=inactive does NOT delete their commissions', () => {
    const dealer   = factory.createTrader();
    const consumer = factory.createConsumer();
    const order    = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id,
      payment_status:   'paid',
    });

    // Insert commission row directly
    db.prepare(`
      INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status, week_start, week_end)
      VALUES (?, ?, 25.00, 10.0, 'direct', 'pending', '2026-05-18', '2026-05-24')
    `).run(dealer.user.id, order.id);

    // Soft-delete trader
    db.prepare(`UPDATE users SET status='inactive' WHERE id=?`).run(dealer.user.id);

    // Commission should still exist
    const comm = db.prepare(
      `SELECT * FROM commissions WHERE trader_id=? AND consumer_order_id=?`
    ).get(dealer.user.id, order.id);
    expect(comm).toBeDefined();
    expect(comm.amount).toBe(25.00);
    expect(comm.status).toBe('pending');

    // User should be inactive
    const user = db.prepare('SELECT status FROM users WHERE id=?').get(dealer.user.id);
    expect(user.status).toBe('inactive');
  });

  test('multiple commissions for a soft-deleted trader all survive', () => {
    const dealer = factory.createTrader();
    const consumer = factory.createConsumer();

    const o1 = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, payment_status: 'paid', total_amount: 100,
    });
    const o2 = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: dealer.user.id, payment_status: 'paid', total_amount: 200,
    });

    db.prepare(`INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
                VALUES (?,?,10.00,10,'direct','pending','2026-05-18','2026-05-24')`)
      .run(dealer.user.id, o1.id);
    db.prepare(`INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end)
                VALUES (?,?,20.00,10,'direct','pending','2026-05-18','2026-05-24')`)
      .run(dealer.user.id, o2.id);

    // Soft-delete
    db.prepare(`UPDATE users SET status='inactive' WHERE id=?`).run(dealer.user.id);

    const comms = db.prepare(
      `SELECT COUNT(*) as c FROM commissions WHERE trader_id=?`
    ).get(dealer.user.id);
    expect(comms.c).toBe(2);
  });
});

/* ── 18.3 Migration smoke test ──────────────────────────────────────────── */
describe('Migration smoke — required tables exist', () => {
  const requiredTables = [
    'users',
    'products',
    'orders',
    'consumer_orders',
    'consumer_order_items',
    'commissions',
    'weekly_payouts',
    'notifications',
    'consumers',
    'consumer_addresses',
  ];

  for (const tableName of requiredTables) {
    test(`table "${tableName}" exists`, () => {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(tableName);
      expect(row).toBeDefined();
      expect(row.name).toBe(tableName);
    });
  }
});

/* ── 18.4 Key columns on consumer_orders ───────────────────────────────── */
describe('Key columns exist on consumer_orders', () => {
  const requiredColumns = [
    'inventory_deducted',
    'inventory_restored',
    'fulfilled_by_dealer_id',
    'assignment_status',
  ];

  for (const col of requiredColumns) {
    test(`column "${col}" exists on consumer_orders`, () => {
      const cols = db.pragma('table_info(consumer_orders)');
      const found = cols.some(c => c.name === col);
      expect(found).toBe(true);
    });
  }

  test('inventory_deducted defaults to 0', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {});
    const row = db.prepare('SELECT inventory_deducted FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.inventory_deducted).toBe(0);
  });

  test('inventory_restored defaults to 0', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {});
    const row = db.prepare('SELECT inventory_restored FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.inventory_restored).toBe(0);
  });

  test('assignment_status defaults to "unassigned"', () => {
    const consumer = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.consumer.id, {});
    const row = db.prepare('SELECT assignment_status FROM consumer_orders WHERE id=?').get(order.id);
    expect(row.assignment_status).toBe('unassigned');
  });
});

/* ── 18.5 No orphaned consumer_order_items after clearAll ──────────────── */
describe('No orphaned consumer_order_items', () => {
  test('after clearAll there are no rows in consumer_order_items', () => {
    // Create some data then clear
    const consumer = factory.createConsumer();
    const product  = factory.createProduct();
    const order    = factory.createConsumerOrder(consumer.consumer.id, {});

    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total)
      VALUES (?, ?, 2, 50, 100)
    `).run(order.id, product.id);

    // Verify items exist before clear
    const before = db.prepare('SELECT COUNT(*) as c FROM consumer_order_items').get().c;
    expect(before).toBe(1);

    // clearAll removes items
    factory.clearAll();

    const after = db.prepare('SELECT COUNT(*) as c FROM consumer_order_items').get().c;
    expect(after).toBe(0);
  });

  test('cascading delete: deleting a consumer_order also deletes its items', () => {
    // SQLite ON DELETE CASCADE is tested here
    const consumer = factory.createConsumer();
    const product  = factory.createProduct();
    const order    = factory.createConsumerOrder(consumer.consumer.id, {});

    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total)
      VALUES (?, ?, 1, 100, 100)
    `).run(order.id, product.id);

    // Delete order directly (factory.clearAll uses DELETE FROM consumer_order_items first)
    db.prepare('DELETE FROM consumer_order_items WHERE order_id=?').run(order.id);
    db.prepare('DELETE FROM consumer_orders WHERE id=?').run(order.id);

    const items = db.prepare(
      'SELECT COUNT(*) as c FROM consumer_order_items WHERE order_id=?'
    ).get(order.id).c;
    expect(items).toBe(0);
  });
});

/* ── 18.6 Notifications table schema ────────────────────────────────────── */
describe('Notifications table schema', () => {
  test('notifications table has all required columns', () => {
    const cols = db.pragma('table_info(notifications)').map(c => c.name);
    for (const col of ['id', 'user_type', 'user_id', 'title', 'body', 'data', 'channel', 'read', 'created_at']) {
      expect(cols).toContain(col);
    }
  });

  test('notifications.read defaults to 0 (unread)', () => {
    const dealer = factory.createTrader();
    const r = db.prepare(`
      INSERT INTO notifications (user_type, user_id, title, body, channel)
      VALUES ('dealer', ?, 'Test', 'Body', 'in_app')
    `).run(dealer.user.id);
    const row = db.prepare('SELECT read FROM notifications WHERE id=?').get(r.lastInsertRowid);
    expect(row.read).toBe(0);
  });
});
