/**
 * Test data factory — creates users, products, orders directly in the DB.
 * Uses bcrypt cost=1 for speed (not security — tests only).
 */
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../../src/database/db');

const SECRET = process.env.JWT_SECRET;

// notificationService.js creates this table on import, but it's mocked in tests.
// We create it here so factory helpers that clear it don't blow up.
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type  TEXT    NOT NULL,
    user_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    data       TEXT,
    channel    TEXT    NOT NULL DEFAULT 'in_app',
    read       INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ── Tokens ──────────────────────────────────────────────────────────────────

function tokenFor(id, role) {
  return jwt.sign({ id, role }, SECRET, { expiresIn: '1h' });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── Users ────────────────────────────────────────────────────────────────────

function createAdmin(overrides = {}) {
  const email = overrides.email || `admin-${Date.now()}@test.com`;
  const hash  = bcrypt.hashSync(overrides.password || 'AdminPass1!', 1);
  const r = db.prepare(`
    INSERT INTO users (name, email, password, role, status)
    VALUES (?, ?, ?, 'admin', 'active')
  `).run(overrides.name || 'Test Admin', email, hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  return { user, token: tokenFor(user.id, 'admin'), headers: authHeader(tokenFor(user.id, 'admin')) };
}

function createTrader(overrides = {}) {
  const email = overrides.email || `trader-${Date.now()}@test.com`;
  const hash  = bcrypt.hashSync(overrides.password || 'TraderPass1!', 1);
  // Unique referral code — use last 6 chars of timestamp
  const code  = overrides.referral_code || `T${Date.now().toString().slice(-5)}`;
  const r = db.prepare(`
    INSERT INTO users
      (name, email, password, role, tier, referral_code, status,
       commission_rate, will_deliver, delivery_enabled,
       latitude, longitude, h3_index, availability_status)
    VALUES (?, ?, ?, 'trader', ?, ?, 'active', 10.0, 1, 1, 12.9716, 77.5946, '872be120fffffff', 'available')
  `).run(
    overrides.name || 'Test Trader', email, hash,
    overrides.tier || 1, code,
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  return { user, token: tokenFor(user.id, 'trader'), headers: authHeader(tokenFor(user.id, 'trader')) };
}

function createConsumer(overrides = {}) {
  const email = overrides.email || `consumer-${Date.now()}@test.com`;
  const phone = overrides.phone || `9${Math.floor(Math.random() * 9e8 + 1e8)}`;
  const hash  = bcrypt.hashSync(overrides.password || 'ConsPass1!', 1);
  const r = db.prepare(`
    INSERT INTO consumers
      (name, email, password, phone, status, email_verified, linked_dealer_id)
    VALUES (?, ?, ?, ?, 'active', 1, ?)
  `).run(
    overrides.name || 'Test Consumer', email, hash, phone,
    overrides.linked_dealer_id || null,
  );
  const consumer = db.prepare('SELECT * FROM consumers WHERE id = ?').get(r.lastInsertRowid);
  return { consumer, token: tokenFor(consumer.id, 'consumer'), headers: authHeader(tokenFor(consumer.id, 'consumer')) };
}

// ── Products ─────────────────────────────────────────────────────────────────

function createProduct(overrides = {}) {
  const sku = overrides.sku || `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const r = db.prepare(`
    INSERT INTO products (name, description, category, sku, price, cost_price, stock, min_stock, unit, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(
    overrides.name        || 'Test Product',
    overrides.description || 'A test product description',
    overrides.category    || 'general',
    sku,
    overrides.price       !== undefined ? overrides.price       : 100.0,
    overrides.cost_price  !== undefined ? overrides.cost_price  : 75.0,
    overrides.stock       !== undefined ? overrides.stock       : 50,
    overrides.min_stock   !== undefined ? overrides.min_stock   : 5,
    overrides.unit        || 'piece',
  );
  return db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid);
}

// ── Consumer Orders ───────────────────────────────────────────────────────────

function createConsumerOrder(consumerId, overrides = {}) {
  const num = `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = db.prepare(`
    INSERT INTO consumer_orders
      (order_number, consumer_id, linked_dealer_id, delivery_dealer_id,
       is_direct, status, payment_status,
       subtotal, discount_percent, discount_amount, total_amount,
       pincode, delivery_address, delivery_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    num,
    consumerId,
    overrides.linked_dealer_id   || null,
    overrides.delivery_dealer_id || null,
    overrides.is_direct          !== undefined ? overrides.is_direct : 0,
    overrides.status             || 'pending',
    overrides.payment_status     || 'paid',
    overrides.subtotal           || 200,
    overrides.discount_percent   || 0,
    overrides.discount_amount    || 0,
    overrides.total_amount       || 200,
    overrides.pincode            || '560001',
    overrides.delivery_address   || '1 Test Road, Bangalore',
    overrides.delivery_status    || 'pending',
  );
  return db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(r.lastInsertRowid);
}

// ── Database Reset ────────────────────────────────────────────────────────────

function clearAll() {
  // Order matters — child rows before parents
  db.prepare('DELETE FROM review_tokens').run();
  db.prepare('DELETE FROM product_reviews').run();
  db.prepare('DELETE FROM consumer_order_items').run();
  db.prepare('DELETE FROM commissions').run();
  db.prepare('DELETE FROM weekly_payouts').run();
  db.prepare('DELETE FROM consumer_orders').run();
  db.prepare('DELETE FROM order_items').run();
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM consumer_addresses').run();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM email_verifications').run();
  db.prepare('DELETE FROM password_resets').run();
  db.prepare('DELETE FROM dealer_inventory').run();
  db.prepare('DELETE FROM inventory_transactions').run();
  db.prepare('DELETE FROM distributions').run();
  db.prepare('DELETE FROM withdrawal_requests').run();
  db.prepare('DELETE FROM consumers').run();
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM users').run();
}

module.exports = {
  tokenFor, authHeader,
  createAdmin, createTrader, createConsumer,
  createProduct, createConsumerOrder,
  clearAll,
};
