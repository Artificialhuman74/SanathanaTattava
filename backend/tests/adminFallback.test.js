/**
 * Admin-fallback assignment
 *
 * When no trader can be resolved as the delivery dealer (no linked dealer,
 * no nearby H3-indexed trader, no referral-chain parent), the order should
 * be assigned to the first active admin user. Warehouse stock (products.stock)
 * is debited at creation, so the order must be marked inventory_deducted at
 * creation, and a later cancel/refund must restore warehouse stock — NOT
 * dealer_inventory, which the admin doesn't have.
 */
const request = require('supertest');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

const { returnOrderInventory } = require('../src/services/inventoryService');

const app = createApp();

beforeEach(() => factory.clearAll());

function warehouseStock(productId) {
  return db.prepare('SELECT stock FROM products WHERE id=?').get(productId).stock;
}

function createOrderAsConsumer(consumer, items, extra = {}) {
  return request(app)
    .post('/api/consumer/orders')
    .set(consumer.headers)
    .send({
      items,
      delivery_address: '1 Test Road, Bangalore',
      pincode: '560001',
      delivery_name: 'Tester',
      delivery_phone: '9999999999',
      ...extra,
    });
}

/* ── Assignment ───────────────────────────────────────────────────────── */
describe('Admin fallback at order creation', () => {
  test('Consumer with no linked dealer and no geo → order assigned to admin', async () => {
    const admin   = factory.createAdmin();
    const product = factory.createProduct({ stock: 50 });
    const consumer = factory.createConsumer(); // no linked dealer

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 2 }]);
    expect(res.status).toBe(201);

    const order = db.prepare('SELECT * FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(order.delivery_dealer_id).toBe(admin.user.id);
    expect(order.assignment_status).toBe('admin');
    expect(order.inventory_deducted).toBe(1);
    expect(order.fulfilled_by_dealer_id).toBe(admin.user.id);
    expect(warehouseStock(product.id)).toBe(48); // 50 - 2
  });

  test('Direct order (no linked dealer, no geo) falls back to admin', async () => {
    const admin   = factory.createAdmin();
    const product = factory.createProduct({ stock: 30 });
    const consumer = factory.createConsumer();

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 5 }]);
    expect(res.status).toBe(201);

    const order = db.prepare('SELECT is_direct, assignment_status, delivery_dealer_id FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(order.is_direct).toBe(1);
    expect(order.delivery_dealer_id).toBe(admin.user.id);
    expect(order.assignment_status).toBe('admin');
  });

  test('Linked dealer with delivery_enabled → does NOT fall back to admin', async () => {
    factory.createAdmin();
    const dealer = factory.createTrader({ tier: 1 });
    // createTrader factory already sets delivery_enabled=1 will_deliver=1
    const product = factory.createProduct({ stock: 40 });
    const consumer = factory.createConsumer({ linked_dealer_id: dealer.user.id });

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 1 }]);
    expect(res.status).toBe(201);

    const order = db.prepare('SELECT * FROM consumer_orders WHERE id=?').get(res.body.order.id);
    // H3 spatial search picks up the dealer (factory sets default coords), so dealer wins
    expect(order.delivery_dealer_id).toBe(dealer.user.id);
    expect(order.assignment_status).not.toBe('admin');
  });

  test('If multiple admins exist, the lowest-id active admin is chosen', async () => {
    const adminA = factory.createAdmin({ email: 'a@test.com' });
    const adminB = factory.createAdmin({ email: 'b@test.com' });
    const product = factory.createProduct({ stock: 10 });
    const consumer = factory.createConsumer();

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 1 }]);
    expect(res.status).toBe(201);

    const order = db.prepare('SELECT delivery_dealer_id FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(order.delivery_dealer_id).toBe(Math.min(adminA.user.id, adminB.user.id));
  });

  test('If no active admin exists, order stays unassigned (no crash)', async () => {
    // Don't create an admin at all
    const product = factory.createProduct({ stock: 10 });
    const consumer = factory.createConsumer();

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 1 }]);
    expect(res.status).toBe(201);

    const order = db.prepare('SELECT delivery_dealer_id, assignment_status, inventory_deducted FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(order.delivery_dealer_id).toBeNull();
    expect(order.assignment_status).toBe('unassigned');
    expect(order.inventory_deducted).toBe(0); // no fulfiller, so cancel won't restore warehouse
  });

  test('Inactive admin is skipped — fallback finds next active admin', async () => {
    const inactive = factory.createAdmin({ email: 'inactive@test.com' });
    db.prepare(`UPDATE users SET status='inactive' WHERE id=?`).run(inactive.user.id);
    const active = factory.createAdmin({ email: 'active@test.com' });
    const product = factory.createProduct({ stock: 10 });
    const consumer = factory.createConsumer();

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 1 }]);
    expect(res.status).toBe(201);

    const order = db.prepare('SELECT delivery_dealer_id FROM consumer_orders WHERE id=?').get(res.body.order.id);
    expect(order.delivery_dealer_id).toBe(active.user.id);
  });
});

/* ── Inventory restore for admin-fulfilled orders ───────────────────────── */
describe('returnOrderInventory for admin-fulfilled orders', () => {
  test('Admin order cancel → restores warehouse (products.stock), not dealer_inventory', async () => {
    const admin   = factory.createAdmin();
    const product = factory.createProduct({ stock: 100 });
    const consumer = factory.createConsumer();

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 7 }]);
    expect(res.status).toBe(201);
    expect(warehouseStock(product.id)).toBe(93);

    const r = returnOrderInventory(res.body.order.id);
    expect(r.success).toBe(true);
    expect(r.restored).toBe(true);
    expect(r.fulfilled_by).toBe('admin');
    expect(warehouseStock(product.id)).toBe(100); // fully restored

    // Admin must not have a dealer_inventory row
    const dealerRow = db.prepare('SELECT quantity FROM dealer_inventory WHERE dealer_id=? AND product_id=?')
      .get(admin.user.id, product.id);
    expect(dealerRow).toBeUndefined();
  });

  test('Admin-fulfilled restore is idempotent (no double-add)', async () => {
    factory.createAdmin();
    const product = factory.createProduct({ stock: 20 });
    const consumer = factory.createConsumer();

    const res = await createOrderAsConsumer(consumer, [{ product_id: product.id, quantity: 4 }]);
    expect(warehouseStock(product.id)).toBe(16);

    returnOrderInventory(res.body.order.id);
    expect(warehouseStock(product.id)).toBe(20);

    const r2 = returnOrderInventory(res.body.order.id);
    expect(r2.restored).toBe(false);
    expect(r2.reason).toBe('already_restored');
    expect(warehouseStock(product.id)).toBe(20); // not 24
  });
});
