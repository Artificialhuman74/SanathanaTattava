/**
 * Migration smoke test (Part 10 — CI gate hardening).
 *
 * Spins up a brand-new SQLite database in a temp dir, runs every migration
 * the production server runs at boot, and asserts that the resulting schema
 * has all the tables, columns, and indexes the rest of the app relies on.
 *
 * If a migration is renamed / dropped / regressed, this test fails loudly
 * before the broken DB hits production.
 */
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

/* ── Fresh DB per test run, isolated from other test files ─────────────── */
const freshDir = path.join(
  os.tmpdir(),
  `tradehub-migrate-smoke-${crypto.randomBytes(4).toString('hex')}`
);
fs.mkdirSync(freshDir, { recursive: true });

let db;
beforeAll(() => {
  jest.resetModules();
  process.env.DATA_DIR = freshDir;
  // Requiring db.js triggers CREATE TABLE IF NOT EXISTS blocks AND runMigrations().
  db = require('../src/database/db');
});

afterAll(() => {
  try { db && db.close && db.close(); } catch (_) {}
  try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
});

// ── helpers ────────────────────────────────────────────────────────────────
const hasTable = (name) => !!db.prepare(
  `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
).get(name);

const columnsOf = (name) => db.pragma(`table_info(${name})`).map(c => c.name);

const hasIndex = (name) => !!db.prepare(
  `SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`
).get(name);

// ── expected schema (only the columns the app code actually depends on) ───
const EXPECTED = {
  users: [
    'id', 'name', 'email', 'password', 'role', 'tier',
    'referral_code', 'referred_by_id', 'phone', 'address', 'pincode',
    'will_deliver', 'delivery_enabled', 'commission_rate', 'status',
    'latitude', 'longitude', 'h3_index', 'availability_status',
    'accepts_delivery_terms', 'email_verified',
    'bank_account_name', 'bank_account_number', 'bank_ifsc',
    'razorpay_linked_account_id', 'razorpay_account_status',
  ],
  products: [
    'id', 'name', 'description', 'category', 'sku', 'price',
    'cost_price', 'stock', 'min_stock', 'image_url', 'image_urls',
    'unit', 'status',
  ],
  orders: ['id', 'order_number', 'trader_id', 'status', 'total_amount'],
  order_items: ['id', 'order_id', 'product_id', 'quantity', 'price', 'total'],
  consumers: [
    'id', 'name', 'email', 'password', 'phone', 'address', 'pincode',
    'referral_code_used', 'linked_dealer_id', 'status', 'email_verified',
  ],
  consumer_otps: ['id', 'phone', 'email', 'otp_hash', 'expires_at', 'used'],
  consumer_orders: [
    'id', 'order_number', 'consumer_id', 'linked_dealer_id',
    'delivery_dealer_id', 'is_direct', 'status', 'payment_status',
    'subtotal', 'discount_percent', 'discount_amount', 'total_amount',
    'pincode', 'delivery_address', 'notes', 'confirmation_sent',
    /* migration 3 */
    'delivery_latitude', 'delivery_longitude', 'delivery_h3_index',
    'delivery_distance_km', 'assignment_status',
    /* migration 6 */
    'delivery_otp', 'delivery_otp_hash', 'delivery_otp_expires_at',
    'delivery_otp_attempts', 'delivery_otp_plain', 'delivery_verified_at',
    'delivery_status', 'delivery_accepted_at', 'delivery_packed_at',
    'delivery_started_at', 'delivery_failed_reason',
    'razorpay_order_id', 'razorpay_payment_id',
    /* migration 12 (refunds + inventory flags) */
    'refund_id', 'refund_status', 'refund_amount',
    'inventory_deducted', 'inventory_restored', 'fulfilled_by_dealer_id',
    'review_email_sent',
  ],
  consumer_order_items: ['id', 'order_id', 'product_id', 'quantity', 'price', 'total'],
  commissions: [
    'id', 'trader_id', 'consumer_order_id', 'amount', 'rate',
    'type', 'status', 'week_start', 'week_end', 'paid_at',
    'razorpay_transfer_id',
    /* offline-confirm flow */
    'payment_method', 'paid_by_trader_id', 'paid_at_offline',
    'confirmation_token', 'confirmation_expires_at', 'confirmed_at',
    'disputed_at', 'dispute_reason', 'payment_note',
  ],
  weekly_payouts: [
    'id', 'trader_id', 'amount', 'week_start', 'week_end',
    'commission_count', 'status', 'razorpay_payout_id',
  ],
  settings: ['key', 'value'],
  consumer_addresses: [
    'id', 'consumer_id', 'label', 'name', 'phone', 'address', 'pincode',
    'latitude', 'longitude', 'h3_index', 'is_default',
  ],
  dealer_inventory: [
    'id', 'dealer_id', 'product_id', 'quantity',
    'low_stock_threshold', 'last_restocked_at',
  ],
  inventory_transactions: [
    'id', 'dealer_id', 'product_id', 'quantity', 'type', 'reference_id',
  ],
  withdrawal_requests: [
    'id', 'trader_id', 'amount', 'upi_id', 'status',
  ],
  distributions: [
    'id', 'product_id', 'dealer_id', 'allocated_qty',
    'received_qty', 'status',
  ],
  product_reviews: [
    'id', 'product_id', 'consumer_id', 'consumer_name',
    'rating', 'body', 'images', 'verified_buyer',
  ],
  review_tokens: [
    'id', 'consumer_id', 'product_id', 'order_id', 'token',
    'expires_at', 'used',
  ],
  razorpay_webhook_events: ['event_id', 'event_type', 'payload', 'received_at'],
  email_verifications: ['id', 'email', 'token_hash', 'expires_at', 'used'],
  password_resets: ['id', 'email', 'token_hash', 'expires_at', 'used'],
};

const EXPECTED_INDEXES = [
  'idx_users_h3',
  'idx_users_availability',
  'idx_dealer_inv_dealer',
  'idx_dealer_inv_product',
  'idx_consumer_addr_h3',
  'idx_commissions_confirmation_token',
];

// ── tests ─────────────────────────────────────────────────────────────────
describe('migration smoke', () => {
  test.each(Object.keys(EXPECTED))('table %s exists', (table) => {
    expect(hasTable(table)).toBe(true);
  });

  test.each(
    Object.entries(EXPECTED).flatMap(([table, cols]) =>
      cols.map(col => [table, col])
    )
  )('column %s.%s exists', (table, col) => {
    expect(columnsOf(table)).toContain(col);
  });

  test.each(EXPECTED_INDEXES)('index %s exists', (idx) => {
    expect(hasIndex(idx)).toBe(true);
  });

  test('consumers.phone is nullable (migration 9)', () => {
    const phoneCol = db.pragma('table_info(consumers)').find(c => c.name === 'phone');
    expect(phoneCol).toBeDefined();
    expect(phoneCol.notnull).toBe(0);
  });

  test('foreign keys are enforced', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('WAL journal mode is active', () => {
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase())
      .toBe('wal');
  });

  test('default settings row is seeded', () => {
    const row = db.prepare(`SELECT value FROM settings WHERE key=?`)
      .get('referral_discount_percent');
    expect(row).toBeDefined();
    expect(row.value).toBe('10');
  });

  test('migrations are idempotent when re-run', () => {
    const { runMigrations } = require('../src/database/migrations');
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();
    // schema still intact
    expect(hasTable('users')).toBe(true);
    expect(columnsOf('users')).toContain('h3_index');
  });
});
