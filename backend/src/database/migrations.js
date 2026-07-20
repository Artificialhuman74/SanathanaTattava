/**
 * Database Migrations
 *
 * Safe, idempotent schema additions.  Each migration checks whether
 * the column/index already exists before altering the table, so this
 * file can be run on every server start without side-effects.
 *
 * Called from db.js after the initial CREATE TABLE IF NOT EXISTS block.
 */

const h3Service = require('../services/h3Service');

function runMigrations(db) {
  /* ── Helper: check if a column exists ──────────────────────────────── */
  const hasColumn = (table, column) => {
    const cols = db.pragma(`table_info(${table})`);
    return cols.some(c => c.name === column);
  };

  /* ── Helper: check if an index exists ──────────────────────────────── */
  const hasIndex = (indexName) => {
    const row = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`
    ).get(indexName);
    return !!row;
  };

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 1:  Add geolocation + H3 fields to USERS (dealers)
   * ═══════════════════════════════════════════════════════════════════ */

  if (!hasColumn('users', 'latitude')) {
    db.exec(`ALTER TABLE users ADD COLUMN latitude REAL`);
    console.log('[migration] users: added latitude');
  }
  if (!hasColumn('users', 'longitude')) {
    db.exec(`ALTER TABLE users ADD COLUMN longitude REAL`);
    console.log('[migration] users: added longitude');
  }
  if (!hasColumn('users', 'h3_index')) {
    db.exec(`ALTER TABLE users ADD COLUMN h3_index TEXT`);
    console.log('[migration] users: added h3_index');
  }
  if (!hasColumn('users', 'availability_status')) {
    db.exec(`ALTER TABLE users ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'available'`);
    console.log('[migration] users: added availability_status');
  }

  // Index for fast kRing lookups
  if (!hasIndex('idx_users_h3')) {
    db.exec(`CREATE INDEX idx_users_h3 ON users(h3_index)`);
    console.log('[migration] users: created idx_users_h3');
  }
  if (!hasIndex('idx_users_availability')) {
    db.exec(`CREATE INDEX idx_users_availability ON users(availability_status, delivery_enabled, will_deliver)`);
    console.log('[migration] users: created idx_users_availability');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 2:  Add lat/lng to CONSUMER_ADDRESSES
   * ═══════════════════════════════════════════════════════════════════ */

  if (!hasColumn('consumer_addresses', 'latitude')) {
    db.exec(`ALTER TABLE consumer_addresses ADD COLUMN latitude REAL`);
    console.log('[migration] consumer_addresses: added latitude');
  }
  if (!hasColumn('consumer_addresses', 'longitude')) {
    db.exec(`ALTER TABLE consumer_addresses ADD COLUMN longitude REAL`);
    console.log('[migration] consumer_addresses: added longitude');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 3:  Add delivery geo fields to CONSUMER_ORDERS
   * ═══════════════════════════════════════════════════════════════════ */

  if (!hasColumn('consumer_orders', 'delivery_latitude')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_latitude REAL`);
    console.log('[migration] consumer_orders: added delivery_latitude');
  }
  if (!hasColumn('consumer_orders', 'delivery_longitude')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_longitude REAL`);
    console.log('[migration] consumer_orders: added delivery_longitude');
  }
  if (!hasColumn('consumer_orders', 'delivery_h3_index')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_h3_index TEXT`);
    console.log('[migration] consumer_orders: added delivery_h3_index');
  }
  if (!hasColumn('consumer_orders', 'delivery_distance_km')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_distance_km REAL`);
    console.log('[migration] consumer_orders: added delivery_distance_km');
  }
  if (!hasColumn('consumer_orders', 'assignment_status')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN assignment_status TEXT NOT NULL DEFAULT 'unassigned'`);
    console.log('[migration] consumer_orders: added assignment_status');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Back-fill:  Compute h3_index for any dealers that already have
   *             lat/lng but no h3_index.
   * ═══════════════════════════════════════════════════════════════════ */

  const needsH3 = db.prepare(`
    SELECT id, latitude, longitude FROM users
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND h3_index IS NULL
  `).all();

  if (needsH3.length > 0) {
    const update = db.prepare(`UPDATE users SET h3_index = ? WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const u of needsH3) {
        const idx = h3Service.latLngToH3Index(u.latitude, u.longitude);
        update.run(idx, u.id);
      }
    });
    tx();
    console.log(`[migration] back-filled h3_index for ${needsH3.length} dealer(s)`);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 4:  Dealer Inventory table
   *
   * Separate stock per dealer per product.  products.stock remains
   * the warehouse (admin) inventory.  dealer_inventory tracks what
   * each dealer has on hand locally.
   * ═══════════════════════════════════════════════════════════════════ */

  db.exec(`
    CREATE TABLE IF NOT EXISTS dealer_inventory (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id           INTEGER NOT NULL REFERENCES users(id),
      product_id          INTEGER NOT NULL REFERENCES products(id),
      quantity            INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 3,
      last_restocked_at   DATETIME,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(dealer_id, product_id)
    )
  `);

  if (!hasIndex('idx_dealer_inv_dealer')) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dealer_inv_dealer ON dealer_inventory(dealer_id)`);
    console.log('[migration] dealer_inventory: created idx_dealer_inv_dealer');
  }
  if (!hasIndex('idx_dealer_inv_product')) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dealer_inv_product ON dealer_inventory(product_id)`);
    console.log('[migration] dealer_inventory: created idx_dealer_inv_product');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 5:  Inventory transaction log (audit trail)
   * ═══════════════════════════════════════════════════════════════════ */

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id     INTEGER NOT NULL REFERENCES users(id),
      product_id    INTEGER NOT NULL REFERENCES products(id),
      quantity      INTEGER NOT NULL,
      type          TEXT    NOT NULL,
      reference_id  INTEGER,
      notes         TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  /* type values: 'restock' (admin→dealer), 'order_deduct' (order packed),
     'adjustment' (manual correction), 'return' (order cancelled) */

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 6:  Delivery OTP & status tracking on CONSUMER_ORDERS
   * ═══════════════════════════════════════════════════════════════════ */

  if (!hasColumn('consumer_orders', 'delivery_otp')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_otp TEXT`);
    console.log('[migration] consumer_orders: added delivery_otp');
  }
  if (!hasColumn('consumer_orders', 'delivery_otp_hash')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_otp_hash TEXT`);
    console.log('[migration] consumer_orders: added delivery_otp_hash');
  }
  if (!hasColumn('consumer_orders', 'delivery_otp_expires_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_otp_expires_at DATETIME`);
    console.log('[migration] consumer_orders: added delivery_otp_expires_at');
  }
  if (!hasColumn('consumer_orders', 'delivery_otp_attempts')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_otp_attempts INTEGER DEFAULT 0`);
    console.log('[migration] consumer_orders: added delivery_otp_attempts');
  }
  if (!hasColumn('consumer_orders', 'delivery_otp_plain')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_otp_plain TEXT`);
    console.log('[migration] consumer_orders: added delivery_otp_plain');
  }
  if (!hasColumn('consumer_orders', 'delivery_verified_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_verified_at DATETIME`);
    console.log('[migration] consumer_orders: added delivery_verified_at');
  }
  if (!hasColumn('consumer_orders', 'delivery_status')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_status TEXT DEFAULT 'pending'`);
    console.log('[migration] consumer_orders: added delivery_status');
  }
  if (!hasColumn('consumer_orders', 'delivery_accepted_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_accepted_at DATETIME`);
    console.log('[migration] consumer_orders: added delivery_accepted_at');
  }
  if (!hasColumn('consumer_orders', 'delivery_packed_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_packed_at DATETIME`);
    console.log('[migration] consumer_orders: added delivery_packed_at');
  }
  if (!hasColumn('consumer_orders', 'delivery_started_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_started_at DATETIME`);
    console.log('[migration] consumer_orders: added delivery_started_at');
  }
  if (!hasColumn('consumer_orders', 'delivery_failed_reason')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN delivery_failed_reason TEXT`);
    console.log('[migration] consumer_orders: added delivery_failed_reason');
  }
  if (!hasColumn('consumer_orders', 'razorpay_order_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN razorpay_order_id TEXT`);
    console.log('[migration] consumer_orders: added razorpay_order_id');
  }
  if (!hasColumn('consumer_orders', 'razorpay_payment_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN razorpay_payment_id TEXT`);
    console.log('[migration] consumer_orders: added razorpay_payment_id');
  }

  // Users table: delivery terms acceptance
  if (!hasColumn('users', 'accepts_delivery_terms')) {
    db.exec(`ALTER TABLE users ADD COLUMN accepts_delivery_terms INTEGER DEFAULT 0`);
    console.log('[migration] users: added accepts_delivery_terms');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 7:  Add h3_index to CONSUMER_ADDRESSES
   *
   * Allows H3-based nearest-dealer matching when a customer selects
   * a saved address at checkout — no need to re-geocode every time.
   * ═══════════════════════════════════════════════════════════════════ */

  if (!hasColumn('consumer_addresses', 'h3_index')) {
    db.exec(`ALTER TABLE consumer_addresses ADD COLUMN h3_index TEXT`);
    console.log('[migration] consumer_addresses: added h3_index');
  }

  if (!hasIndex('idx_consumer_addr_h3')) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_consumer_addr_h3 ON consumer_addresses(h3_index)`);
    console.log('[migration] consumer_addresses: created idx_consumer_addr_h3');
  }

  // Back-fill: compute h3_index for addresses that already have lat/lng
  const addrNeedsH3 = db.prepare(`
    SELECT id, latitude, longitude FROM consumer_addresses
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND h3_index IS NULL
  `).all();

  if (addrNeedsH3.length > 0) {
    const updateAddr = db.prepare(`UPDATE consumer_addresses SET h3_index = ? WHERE id = ?`);
    const txAddr = db.transaction(() => {
      for (const a of addrNeedsH3) {
        try {
          const idx = h3Service.latLngToH3Index(a.latitude, a.longitude);
          updateAddr.run(idx, a.id);
        } catch (e) {
          console.error(`[migration] Failed to compute h3 for address ${a.id}:`, e.message);
        }
      }
    });
    txAddr();
    console.log(`[migration] back-filled h3_index for ${addrNeedsH3.length} consumer address(es)`);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 8:  Withdrawal requests table
   * ═══════════════════════════════════════════════════════════════════ */
  db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      trader_id    INTEGER NOT NULL REFERENCES users(id),
      amount       REAL    NOT NULL,
      upi_id       TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      admin_notes  TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    )
  `);

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 9:  Make consumers.phone nullable
   *
   * The original schema had phone TEXT UNIQUE NOT NULL, which breaks
   * email-only registrations. Recreate the table with phone nullable.
   * ═══════════════════════════════════════════════════════════════════ */
  const phoneInfo = db.pragma('table_info(consumers)').find(c => c.name === 'phone');
  if (phoneInfo && phoneInfo.notnull === 1) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS consumers_v2 (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        name               TEXT NOT NULL,
        email              TEXT UNIQUE,
        password           TEXT,
        phone              TEXT UNIQUE,
        address            TEXT,
        pincode            TEXT,
        referral_code_used TEXT,
        linked_dealer_id   INTEGER REFERENCES users(id),
        status             TEXT NOT NULL DEFAULT 'active',
        email_verified     INTEGER NOT NULL DEFAULT 0,
        created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT OR IGNORE INTO consumers_v2
        (id, name, email, password, phone, address, pincode,
         referral_code_used, linked_dealer_id, status, email_verified, created_at)
      SELECT id, name, email, password,
             CASE WHEN phone = '' THEN NULL ELSE phone END,
             address, pincode, referral_code_used, linked_dealer_id,
             status,
             COALESCE(email_verified, 0),
             created_at
      FROM consumers
    `);
    db.exec(`DROP TABLE consumers`);
    db.exec(`ALTER TABLE consumers_v2 RENAME TO consumers`);
    db.exec(`PRAGMA foreign_keys = ON`);
    console.log('[migration] consumers: phone is now nullable');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 10: Stock distribution tracking table
   * ═══════════════════════════════════════════════════════════════════ */
  db.exec(`
    CREATE TABLE IF NOT EXISTS distributions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id     INTEGER NOT NULL REFERENCES products(id),
      dealer_id      INTEGER NOT NULL REFERENCES users(id),
      allocated_qty  INTEGER NOT NULL,
      received_qty   INTEGER,
      status         TEXT    NOT NULL DEFAULT 'pending',
      notes          TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      received_at    DATETIME
    )
  `);

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 11: Product reviews + review tokens
   * ═══════════════════════════════════════════════════════════════════ */
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      consumer_id    INTEGER NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
      consumer_name  TEXT    NOT NULL,
      rating         INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      body           TEXT,
      images         TEXT,
      verified_buyer INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, consumer_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS review_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      consumer_id INTEGER NOT NULL REFERENCES consumers(id),
      product_id  INTEGER NOT NULL REFERENCES products(id),
      order_id    INTEGER NOT NULL REFERENCES consumer_orders(id),
      token       TEXT    UNIQUE NOT NULL,
      expires_at  DATETIME NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!hasColumn('consumer_orders', 'review_email_sent')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN review_email_sent INTEGER NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_orders: added review_email_sent');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration 12: Razorpay full-lifecycle columns
   *   - Refunds: track refund_id + status on consumer_orders
   *   - Webhook idempotency: processed_webhook_events table
   *   - Route/Linked Accounts: bank details + linked_account_id on users
   *   - Per-transfer reconciliation: transfer_id on commissions
   *                                  + razorpay_payout_id on weekly_payouts
   * ═══════════════════════════════════════════════════════════════════ */
  if (!hasColumn('consumer_orders', 'refund_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN refund_id TEXT`);
    console.log('[migration] consumer_orders: added refund_id');
  }
  if (!hasColumn('consumer_orders', 'refund_status')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN refund_status TEXT`);
    console.log('[migration] consumer_orders: added refund_status');
  }
  if (!hasColumn('consumer_orders', 'refund_amount')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN refund_amount REAL`);
    console.log('[migration] consumer_orders: added refund_amount');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
      event_id    TEXT PRIMARY KEY,
      event_type  TEXT NOT NULL,
      payload     TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!hasColumn('users', 'bank_account_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN bank_account_name TEXT`);
    console.log('[migration] users: added bank_account_name');
  }
  if (!hasColumn('users', 'bank_account_number')) {
    db.exec(`ALTER TABLE users ADD COLUMN bank_account_number TEXT`);
    console.log('[migration] users: added bank_account_number');
  }
  if (!hasColumn('users', 'bank_ifsc')) {
    db.exec(`ALTER TABLE users ADD COLUMN bank_ifsc TEXT`);
    console.log('[migration] users: added bank_ifsc');
  }
  if (!hasColumn('users', 'razorpay_linked_account_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN razorpay_linked_account_id TEXT`);
    console.log('[migration] users: added razorpay_linked_account_id');
  }
  if (!hasColumn('users', 'razorpay_account_status')) {
    db.exec(`ALTER TABLE users ADD COLUMN razorpay_account_status TEXT`);
    console.log('[migration] users: added razorpay_account_status');
  }
  if (!hasColumn('users', 'razorpay_product_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN razorpay_product_id TEXT`);
    console.log('[migration] users: added razorpay_product_id');
  }

  if (!hasColumn('commissions', 'razorpay_transfer_id')) {
    db.exec(`ALTER TABLE commissions ADD COLUMN razorpay_transfer_id TEXT`);
    console.log('[migration] commissions: added razorpay_transfer_id');
  }
  if (!hasColumn('weekly_payouts', 'razorpay_payout_id')) {
    db.exec(`ALTER TABLE weekly_payouts ADD COLUMN razorpay_payout_id TEXT`);
    console.log('[migration] weekly_payouts: added razorpay_payout_id');
  }

  /* Sub-dealer commission offline-payment confirmation flow */
  const commCols = [
    ['payment_method',          'TEXT'],
    ['paid_by_trader_id',       'INTEGER REFERENCES users(id)'],
    ['paid_at_offline',         'DATETIME'],
    ['confirmation_token',      'TEXT'],
    ['confirmation_expires_at', 'DATETIME'],
    ['confirmed_at',            'DATETIME'],
    ['disputed_at',             'DATETIME'],
    ['dispute_reason',          'TEXT'],
    ['payment_note',            'TEXT'],
  ];
  for (const [col, decl] of commCols) {
    if (!hasColumn('commissions', col)) {
      db.exec(`ALTER TABLE commissions ADD COLUMN ${col} ${decl}`);
      console.log(`[migration] commissions: added ${col}`);
    }
  }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_commissions_confirmation_token ON commissions(confirmation_token)`); } catch (_) {}

  /* Inventory-restore idempotency flag */
  if (!hasColumn('consumer_orders', 'inventory_deducted')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN inventory_deducted INTEGER NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_orders: added inventory_deducted');
  }
  if (!hasColumn('consumer_orders', 'inventory_restored')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN inventory_restored INTEGER NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_orders: added inventory_restored');
  }
  if (!hasColumn('consumer_orders', 'fulfilled_by_dealer_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN fulfilled_by_dealer_id INTEGER REFERENCES users(id)`);
    console.log('[migration] consumer_orders: added fulfilled_by_dealer_id');
  }
  /* Back-fill: orders previously marked as packed/shipped/delivered must
     have had inventory deducted under the old flow. */
  try {
    db.exec(`
      UPDATE consumer_orders
      SET inventory_deducted = 1
      WHERE inventory_deducted = 0
        AND status IN ('processing','shipped','delivered')
    `);
  } catch (_) {}

  if (!hasColumn('users', 'pan')) {
    db.exec(`ALTER TABLE users ADD COLUMN pan TEXT`);
    console.log('[migration] users: added pan');
  }
  if (!hasColumn('users', 'pan_verified')) {
    db.exec(`ALTER TABLE users ADD COLUMN pan_verified INTEGER NOT NULL DEFAULT 0`);
    console.log('[migration] users: added pan_verified');
  }

  // pan_celebrated = whether the PAN-verified confetti has been shown to the
  // trader yet. Reset to 0 on each verify transition; set to 1 once the
  // frontend acknowledges the celebration. Backfill existing verified users
  // to 1 so they don't get a sudden celebration on their next login.
  if (!hasColumn('users', 'pan_celebrated')) {
    db.exec(`ALTER TABLE users ADD COLUMN pan_celebrated INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE users SET pan_celebrated = 1 WHERE pan_verified = 1`);
    console.log('[migration] users: added pan_celebrated (backfilled for existing verified)');
  }

  // Keep admin as fallback-only — not in the H3 active delivery network
  db.exec(`
    UPDATE users
    SET will_deliver = 0, delivery_enabled = 0
    WHERE role = 'admin'
  `);

  // Ensure admin has the correct name and phone
  db.exec(`
    UPDATE users
    SET name = 'Ravikumar', phone = '9972922514'
    WHERE role = 'admin'
  `);

  /* ── Razorpay Invoice columns ───────────────────────────────────────── */
  if (!hasColumn('consumer_orders', 'razorpay_invoice_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN razorpay_invoice_id TEXT`);
    console.log('[migration] consumer_orders: added razorpay_invoice_id');
  }
  if (!hasColumn('consumer_orders', 'razorpay_invoice_status')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN razorpay_invoice_status TEXT`);
    console.log('[migration] consumer_orders: added razorpay_invoice_status');
  }
  if (!hasColumn('consumer_orders', 'razorpay_container_invoice_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN razorpay_container_invoice_id TEXT`);
    console.log('[migration] consumer_orders: added razorpay_container_invoice_id');
  }
  if (!hasColumn('consumer_orders', 'razorpay_container_invoice_status')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN razorpay_container_invoice_status TEXT`);
    console.log('[migration] consumer_orders: added razorpay_container_invoice_status');
  }

  /* ── Container cost columns ─────────────────────────────────────────── */
  if (!hasColumn('products', 'container_cost')) {
    db.exec(`ALTER TABLE products ADD COLUMN container_cost REAL NOT NULL DEFAULT 0`);
    console.log('[migration] products: added container_cost');
  }

  /* container_type identifies the physical container SKU (e.g. '2.8L', '5L').
   * Used to match same-size containers for the consumer Swap flow — volume
   * alone is unsafe (a 2.8L PET ≠ a 2.8L steel). v1 ships steel only.
   * NULL for products that don't carry a deposit. */
  if (!hasColumn('products', 'container_type')) {
    db.exec(`ALTER TABLE products ADD COLUMN container_type TEXT`);
    console.log('[migration] products: added container_type');
  }
  if (!hasColumn('consumer_order_items', 'container_cost')) {
    db.exec(`ALTER TABLE consumer_order_items ADD COLUMN container_cost REAL NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_order_items: added container_cost');
  }
  /* is_refill marks lines where the consumer re-uses a held container.
   * Drives delivery-agent UI ("Refill exchange" vs "New container") and
   * the "(Refill)" suffix on tax invoices. */
  if (!hasColumn('consumer_order_items', 'is_refill')) {
    db.exec(`ALTER TABLE consumer_order_items ADD COLUMN is_refill INTEGER NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_order_items: added is_refill');
  }
  if (!hasColumn('consumer_orders', 'container_costs_total')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN container_costs_total REAL NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_orders: added container_costs_total');
  }

  /* Phase 7 — store credit applied at checkout. Stamps the amount of
   * wallet credit consumed by an order; ledger row carries the audit. */
  if (!hasColumn('consumer_orders', 'store_credit_applied')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN store_credit_applied REAL NOT NULL DEFAULT 0`);
    console.log('[migration] consumer_orders: added store_credit_applied');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration: Finance log tables (manual income + trader payments)
   * ═══════════════════════════════════════════════════════════════════ */
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_income (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT    NOT NULL,
      description   TEXT,
      amount        REAL    NOT NULL,
      recorded_date TEXT    NOT NULL,
      created_by    INTEGER REFERENCES users(id),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_income_date ON manual_income(recorded_date)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trader_payments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      trader_id     INTEGER NOT NULL REFERENCES users(id),
      amount        REAL    NOT NULL,
      payment_date  TEXT    NOT NULL,
      notes         TEXT,
      created_by    INTEGER REFERENCES users(id),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trader_payments_date ON trader_payments(payment_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trader_payments_trader ON trader_payments(trader_id)`);

  /* ═══════════════════════════════════════════════════════════════════
   * GST-compliant self-generated invoices (replaces Razorpay Invoices API)
   * ═══════════════════════════════════════════════════════════════════ */
  if (!hasColumn('products', 'hsn_code')) {
    db.exec(`ALTER TABLE products ADD COLUMN hsn_code TEXT`);
    console.log('[migration] products: added hsn_code');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number       TEXT    NOT NULL UNIQUE,
      order_id             INTEGER NOT NULL UNIQUE REFERENCES consumer_orders(id),
      customer_name        TEXT    NOT NULL,
      customer_email       TEXT,
      customer_phone       TEXT,
      customer_address     TEXT,
      customer_state       TEXT,
      customer_gstin       TEXT,
      items_json           TEXT    NOT NULL,
      taxable_amount       REAL    NOT NULL,
      cgst_amount          REAL    NOT NULL DEFAULT 0,
      sgst_amount          REAL    NOT NULL DEFAULT 0,
      igst_amount          REAL    NOT NULL DEFAULT 0,
      total_amount         REAL    NOT NULL,
      razorpay_payment_id  TEXT,
      pdf_path             TEXT,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number)`);

  if (!hasColumn('invoices', 'container_deposit')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN container_deposit REAL NOT NULL DEFAULT 0`);
    console.log('[migration] invoices: added container_deposit');
  }

  /* Deposit lifecycle: 'held' (default after delivery) → 'refunded' or 'forfeited'.
   * 'none' = no deposit was ever charged on this invoice. */
  if (!hasColumn('invoices', 'container_deposit_status')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN container_deposit_status TEXT NOT NULL DEFAULT 'none'`);
    db.exec(`UPDATE invoices SET container_deposit_status='held' WHERE container_deposit > 0`);
    console.log('[migration] invoices: added container_deposit_status');
  }
  if (!hasColumn('invoices', 'container_deposit_resolved_at')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN container_deposit_resolved_at DATETIME`);
    console.log('[migration] invoices: added container_deposit_resolved_at');
  }
  if (!hasColumn('invoices', 'container_deposit_resolved_by')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN container_deposit_resolved_by INTEGER REFERENCES users(id)`);
    console.log('[migration] invoices: added container_deposit_resolved_by');
  }
  if (!hasColumn('invoices', 'container_deposit_notes')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN container_deposit_notes TEXT`);
    console.log('[migration] invoices: added container_deposit_notes');
  }
  /* Supplementary tax invoice issued when a deposit is forfeited (parent → child link). */
  if (!hasColumn('invoices', 'parent_invoice_id')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN parent_invoice_id INTEGER REFERENCES invoices(id)`);
    console.log('[migration] invoices: added parent_invoice_id');
  }
  if (!hasColumn('invoices', 'invoice_type')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN invoice_type TEXT NOT NULL DEFAULT 'tax'`);
    console.log('[migration] invoices: added invoice_type');
  }

  /* Drop UNIQUE constraint on invoices.order_id so we can issue supplementary
   * invoices (deposit-forfeit debit notes) tied to the same original order.
   * SQLite has no DROP CONSTRAINT — must rebuild the table. */
  const idxList = db.prepare(`PRAGMA index_list('invoices')`).all();
  const hasOrderIdUnique = idxList.some(idx => {
    if (!idx.unique) return false;
    const cols = db.prepare(`PRAGMA index_info('${idx.name}')`).all();
    return cols.length === 1 && cols[0].name === 'order_id';
  });
  if (hasOrderIdUnique) {
    console.log('[migration] invoices: rebuilding to drop UNIQUE on order_id…');
    /* Per the SQLite ALTER TABLE workaround (https://sqlite.org/lang_altertable.html#otheralter),
     * FK enforcement must be disabled across the rebuild because dependent tables
     * (container_holdings, etc.) hold rows referencing invoices.id. PRAGMA can't
     * be toggled inside a transaction, so we do it outside. */
    const fkWasOn = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      const rebuild = db.transaction(() => {
        db.exec(`
          CREATE TABLE invoices_new (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number                TEXT    NOT NULL UNIQUE,
            order_id                      INTEGER NOT NULL REFERENCES consumer_orders(id),
            customer_name                 TEXT    NOT NULL,
            customer_email                TEXT,
            customer_phone                TEXT,
            customer_address              TEXT,
            customer_state                TEXT,
            customer_gstin                TEXT,
            items_json                    TEXT    NOT NULL,
            taxable_amount                REAL    NOT NULL,
            cgst_amount                   REAL    NOT NULL DEFAULT 0,
            sgst_amount                   REAL    NOT NULL DEFAULT 0,
            igst_amount                   REAL    NOT NULL DEFAULT 0,
            container_deposit             REAL    NOT NULL DEFAULT 0,
            total_amount                  REAL    NOT NULL,
            razorpay_payment_id           TEXT,
            pdf_path                      TEXT,
            container_deposit_status      TEXT    NOT NULL DEFAULT 'none',
            container_deposit_resolved_at DATETIME,
            container_deposit_resolved_by INTEGER REFERENCES users(id),
            container_deposit_notes       TEXT,
            parent_invoice_id             INTEGER REFERENCES invoices(id),
            invoice_type                  TEXT    NOT NULL DEFAULT 'tax',
            created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO invoices_new
            SELECT id, invoice_number, order_id, customer_name, customer_email, customer_phone,
                   customer_address, customer_state, customer_gstin, items_json,
                   taxable_amount, cgst_amount, sgst_amount, igst_amount,
                   container_deposit, total_amount, razorpay_payment_id, pdf_path,
                   container_deposit_status, container_deposit_resolved_at,
                   container_deposit_resolved_by, container_deposit_notes,
                   parent_invoice_id, invoice_type, created_at
            FROM invoices;
          DROP TABLE invoices;
          ALTER TABLE invoices_new RENAME TO invoices;
          CREATE INDEX idx_invoices_order  ON invoices(order_id);
          CREATE INDEX idx_invoices_number ON invoices(invoice_number);
          CREATE INDEX idx_invoices_parent ON invoices(parent_invoice_id);
        `);
      });
      rebuild();
      /* Confirm FK graph is still consistent before re-enabling enforcement. */
      const violations = db.pragma('foreign_key_check');
      if (violations.length) {
        throw new Error(`invoices rebuild left FK violations: ${JSON.stringify(violations)}`);
      }
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }
    /* Re-enforce idempotency on original tax invoices via a partial unique index. */
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tax_order ON invoices(order_id) WHERE invoice_type='tax'`);
    console.log('[migration] invoices: rebuild done');
  } else {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tax_order ON invoices(order_id) WHERE invoice_type='tax'`);
  }

  /* ── Consumer Containers feature ──────────────────────────────────────
   * Per-line holdings ledger. One row = one physical steel container the
   * consumer holds (or is in transit to them). Replaces the aggregate
   * invoices.container_deposit_status as the operational source of truth.
   * See CONTAINERS_FEATURE_SPEC.md for the full lifecycle.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS container_holdings (
      id                   INTEGER  PRIMARY KEY AUTOINCREMENT,
      consumer_id          INTEGER  NOT NULL REFERENCES consumers(id),
      invoice_id           INTEGER  NOT NULL REFERENCES invoices(id),
      order_item_id        INTEGER  REFERENCES consumer_order_items(id),
      original_product_id  INTEGER  NOT NULL REFERENCES products(id),
      current_product_id   INTEGER  NOT NULL REFERENCES products(id),
      container_type       TEXT     NOT NULL,
      deposit_amount       REAL     NOT NULL,
      status               TEXT     NOT NULL DEFAULT 'pending_delivery',
      refund_destination   TEXT,
      requested_at         DATETIME,
      resolved_at          DATETIME,
      resolved_by          INTEGER  REFERENCES users(id),
      notes                TEXT,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_consumer_status ON container_holdings(consumer_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_invoice         ON container_holdings(invoice_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_current_product ON container_holdings(current_product_id)`);

  /* Phase 7 — manual_bank refund settlement audit. UTR is the bank
   * reference number admin enters when they wire the deposit back. */
  if (!hasColumn('container_holdings', 'manual_refund_utr')) {
    db.exec(`ALTER TABLE container_holdings ADD COLUMN manual_refund_utr TEXT`);
    console.log('[migration] container_holdings: added manual_refund_utr');
  }
  if (!hasColumn('container_holdings', 'manual_refund_paid_at')) {
    db.exec(`ALTER TABLE container_holdings ADD COLUMN manual_refund_paid_at DATETIME`);
    console.log('[migration] container_holdings: added manual_refund_paid_at');
  }
  if (!hasColumn('container_holdings', 'manual_refund_paid_by')) {
    db.exec(`ALTER TABLE container_holdings ADD COLUMN manual_refund_paid_by INTEGER REFERENCES users(id)`);
    console.log('[migration] container_holdings: added manual_refund_paid_by');
  }
  /* Phase 10 — admin-paid refunds can now go out via UPI, not only bank
   * wire. `manual_refund_method` records which channel was used so the
   * finance report can split bank vs UPI. `manual_refund_utr` is reused
   * as the generic payment reference (UTR for bank, UPI txn id for UPI). */
  if (!hasColumn('container_holdings', 'manual_refund_method')) {
    db.exec(`ALTER TABLE container_holdings ADD COLUMN manual_refund_method TEXT`);
    console.log('[migration] container_holdings: added manual_refund_method');
  }

  /* Phase 10 — admins can hide stale entries from the Container Finance
   * History tab without losing the row (Finance summary still sums them).
   * Setting hidden_at to a timestamp removes the row from the default
   * History view; the row stays in the DB and in /admin/finance/summary. */
  if (!hasColumn('container_finance_log', 'hidden_at')) {
    db.exec(`ALTER TABLE container_finance_log ADD COLUMN hidden_at TIMESTAMP`);
    console.log('[migration] container_finance_log: added hidden_at');
  }

  /* Phase 8 — admin holdings override audit. Every admin-initiated status
   * change on a container_holdings row writes one row here. Append-only. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS container_holdings_audit (
      id                 INTEGER  PRIMARY KEY AUTOINCREMENT,
      holding_id         INTEGER  NOT NULL REFERENCES container_holdings(id),
      actor_user_id      INTEGER  NOT NULL REFERENCES users(id),
      action             TEXT     NOT NULL,
      before_status      TEXT,
      after_status       TEXT,
      before_destination TEXT,
      after_destination  TEXT,
      notes              TEXT,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_audit_holding ON container_holdings_audit(holding_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_audit_actor   ON container_holdings_audit(actor_user_id)`);

  /* Swap audit trail. The holding's current_product_id is mutated in-place;
   * this table preserves the full reassignment history. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS container_swaps (
      id              INTEGER  PRIMARY KEY AUTOINCREMENT,
      holding_id      INTEGER  NOT NULL REFERENCES container_holdings(id),
      from_product_id INTEGER  NOT NULL REFERENCES products(id),
      to_product_id   INTEGER  NOT NULL REFERENCES products(id),
      diff_amount     REAL     NOT NULL DEFAULT 0,
      diff_payment_id TEXT,
      triggered_in    TEXT     NOT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_swaps_holding ON container_swaps(holding_id)`);

  /* Append-only store credit ledger. Balance = SUM(delta) per consumer.
   * Used as an opt-in refund destination for container opt-outs. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS consumer_store_credit_ledger (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      consumer_id  INTEGER  NOT NULL REFERENCES consumers(id),
      delta        REAL     NOT NULL,
      reason       TEXT     NOT NULL,
      source_type  TEXT,
      source_id    INTEGER,
      created_by   INTEGER  REFERENCES users(id),
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_store_credit_consumer ON consumer_store_credit_ledger(consumer_id)`);

  /* ── Phase 9 — driver-fronted UPI refunds, damage disputes, photo proofs ──
   * Workflow:
   *   1. Delivery agent inspects → no damage → pays consumer via their own
   *      UPI, uploads screenshot (refund_proof_url, refund_paid_via='manual_upi')
   *   2. Admin verifies in /admin/container-deposits → stamps admin_verified_at
   *   3. Admin reimburses the driver → stamps driver_reimbursed_at + amount
   *   4. Damage path → forfeited + damage_photo_url + dispute_deadline (now+48h)
   *      + admin email; consumer can dispute via WhatsApp during the 48h window
   */
  const holdingsP9Cols = [
    ['refund_proof_url',         `TEXT`],
    ['refund_paid_via',          `TEXT`],
    ['admin_verified_at',        `DATETIME`],
    ['admin_verified_by',        `INTEGER REFERENCES users(id)`],
    ['driver_user_id',           `INTEGER REFERENCES users(id)`],
    ['driver_reimbursed_at',     `DATETIME`],
    ['driver_reimbursed_by',     `INTEGER REFERENCES users(id)`],
    ['driver_reimbursed_amount', `REAL`],
    ['damage_photo_url',         `TEXT`],
    ['damage_dispute_status',    `TEXT`],
    ['dispute_deadline',         `DATETIME`],
    ['dispute_opened_at',        `DATETIME`],
    ['dispute_resolved_at',      `DATETIME`],
    ['dispute_resolved_by',      `INTEGER REFERENCES users(id)`],
  ];
  for (const [col, type] of holdingsP9Cols) {
    if (!hasColumn('container_holdings', col)) {
      db.exec(`ALTER TABLE container_holdings ADD COLUMN ${col} ${type}`);
      console.log(`[migration] container_holdings: added ${col}`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_pending_verification
             ON container_holdings(admin_verified_at, refund_proof_url)
             WHERE refund_proof_url IS NOT NULL AND admin_verified_at IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_pending_reimbursement
             ON container_holdings(admin_verified_at, driver_reimbursed_at)
             WHERE admin_verified_at IS NOT NULL AND driver_reimbursed_at IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_holdings_disputes
             ON container_holdings(damage_dispute_status)
             WHERE damage_dispute_status IS NOT NULL`);

  /* Append-only finance audit. Every money movement (refund proof upload,
   * admin verification, driver reimbursement, dispute decision) lands here
   * so /admin/finance can reconstruct the full money trail. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS container_finance_log (
      id            INTEGER  PRIMARY KEY AUTOINCREMENT,
      holding_id    INTEGER  REFERENCES container_holdings(id),
      consumer_id   INTEGER  REFERENCES consumers(id),
      driver_user_id INTEGER REFERENCES users(id),
      event_type    TEXT     NOT NULL,
      amount        REAL     NOT NULL DEFAULT 0,
      direction     TEXT     NOT NULL,
      actor_user_id INTEGER  REFERENCES users(id),
      reference     TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_finance_log_event   ON container_finance_log(event_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_finance_log_holding ON container_finance_log(holding_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_finance_log_driver  ON container_finance_log(driver_user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_finance_log_created ON container_finance_log(created_at)`);

  /* Settings: support WhatsApp number (already shown in support page,
   * also used by the damage-dispute button on consumer side). */
  db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('support_whatsapp_number','919972922514')`).run();

  /* Backfill: for every existing tax invoice with a held deposit, materialise
   * one container_holdings row per delivered unit so legacy orders show up in
   * the new consumer UI. Idempotent — guarded by NOT EXISTS on invoice_id. */
  const backfillNeeded = db.prepare(`
    SELECT COUNT(*) AS n
      FROM invoices i
     WHERE i.invoice_type='tax'
       AND i.container_deposit_status='held'
       AND i.container_deposit > 0
       AND NOT EXISTS (SELECT 1 FROM container_holdings h WHERE h.invoice_id=i.id)
  `).get();

  if (backfillNeeded.n > 0) {
    console.log(`[migration] container_holdings: backfilling from ${backfillNeeded.n} legacy invoice(s)…`);
    const legacy = db.prepare(`
      SELECT i.id AS invoice_id, i.order_id, co.consumer_id
        FROM invoices i
        JOIN consumer_orders co ON co.id=i.order_id
       WHERE i.invoice_type='tax'
         AND i.container_deposit_status='held'
         AND i.container_deposit > 0
         AND NOT EXISTS (SELECT 1 FROM container_holdings h WHERE h.invoice_id=i.id)
    `).all();

    const insertHolding = db.prepare(`
      INSERT INTO container_holdings
        (consumer_id, invoice_id, order_item_id, original_product_id, current_product_id,
         container_type, deposit_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'held')
    `);

    const itemsByOrder = db.prepare(`
      SELECT oi.id AS order_item_id, oi.product_id, oi.quantity, oi.container_cost,
             p.container_type
        FROM consumer_order_items oi
        JOIN products p ON p.id=oi.product_id
       WHERE oi.order_id=? AND oi.container_cost > 0
    `);

    const backfill = db.transaction(() => {
      for (const inv of legacy) {
        const items = itemsByOrder.all(inv.order_id);
        for (const item of items) {
          // If container_type wasn't set on the product yet (pre-this-migration data),
          // skip — admin must set it then re-run. Logged for visibility.
          if (!item.container_type) {
            console.warn(`[migration] backfill: product ${item.product_id} has no container_type — skipping ${item.quantity} unit(s) on invoice ${inv.invoice_id}`);
            continue;
          }
          for (let q = 0; q < item.quantity; q++) {
            insertHolding.run(
              inv.consumer_id, inv.invoice_id, item.order_item_id,
              item.product_id, item.product_id,
              item.container_type, item.container_cost
            );
          }
        }
      }
    });
    backfill();
    const created = db.prepare(`SELECT COUNT(*) AS n FROM container_holdings WHERE status='held'`).get();
    console.log(`[migration] container_holdings: backfill complete — ${created.n} held row(s)`);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration: Admin takeover + manual-override columns on consumer_orders
   *
   * - original_delivery_dealer_id: the driver the order was originally
   *   assigned to before admin took over. Lets the original driver still
   *   see the order (read-only) on their dashboard.
   * - admin_taken_over_at: timestamp when admin took over. Drives the
   *   read-only banner for the original driver and the "Delivered by
   *   [Admin] (admin)" card label when admin completes via OTP.
   * - admin_overridden_at: timestamp when admin completed delivery via
   *   the manual status dropdown (bypassing OTP). Drives the
   *   "Delivered directly by [Admin]" card label.
   * ═══════════════════════════════════════════════════════════════════ */
  if (!hasColumn('consumer_orders', 'original_delivery_dealer_id')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN original_delivery_dealer_id INTEGER REFERENCES users(id)`);
    console.log('[migration] consumer_orders: added original_delivery_dealer_id');
  }
  if (!hasColumn('consumer_orders', 'admin_taken_over_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN admin_taken_over_at TIMESTAMP`);
    console.log('[migration] consumer_orders: added admin_taken_over_at');
  }
  if (!hasColumn('consumer_orders', 'admin_overridden_at')) {
    db.exec(`ALTER TABLE consumer_orders ADD COLUMN admin_overridden_at TIMESTAMP`);
    console.log('[migration] consumer_orders: added admin_overridden_at');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration: Convert product image data URLs from WebP → JPEG (q=92)
   *
   * An earlier migration converted product images from JPEG → WebP for
   * smaller payloads, but WebP at our quality setting produced visibly
   * "cheap" results on product detail views. We're moving back to JPEG
   * at q=92 (visually crisp, universally supported).
   *
   * This migration is idempotent and only touches WebP data URLs:
   *   - data:image/webp;base64,...  → re-encoded as JPEG q=92
   *   - data:image/jpeg;base64,...  → left alone (don't re-encode and
   *                                   lose more quality)
   *   - anything else (http URL, null) → left alone
   * ═══════════════════════════════════════════════════════════════════ */
  try {
    const sharp = require('sharp');
    const isWebpDataUrl = (s) =>
      typeof s === 'string' && s.startsWith('data:image/webp;base64,');
    const toJpegDataUrl = async (webpDataUrl) => {
      const b64 = webpDataUrl.slice('data:image/webp;base64,'.length);
      const buf = Buffer.from(b64, 'base64');
      const out = await sharp(buf)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      return `data:image/jpeg;base64,${out.toString('base64')}`;
    };

    const rows = db.prepare(`SELECT id, image_url, image_urls FROM products`).all();
    let convertedPrimary = 0;
    let convertedExtras  = 0;
    let scannedProducts  = 0;
    const update = db.prepare(`UPDATE products SET image_url=?, image_urls=? WHERE id=?`);

    const work = (async () => {
      for (const r of rows) {
        scannedProducts++;
        let primary = r.image_url;
        let urls    = r.image_urls;
        let changed = false;

        if (isWebpDataUrl(primary)) {
          try {
            primary = await toJpegDataUrl(primary);
            convertedPrimary++;
            changed = true;
          } catch (e) {
            console.warn(`[migration] jpeg convert failed for product ${r.id} primary:`, e.message);
          }
        }

        if (typeof urls === 'string' && urls.length > 0) {
          let parsed = null;
          try { parsed = JSON.parse(urls); } catch (_) { parsed = null; }
          if (Array.isArray(parsed)) {
            let arrChanged = false;
            for (let i = 0; i < parsed.length; i++) {
              if (isWebpDataUrl(parsed[i])) {
                try {
                  parsed[i] = await toJpegDataUrl(parsed[i]);
                  convertedExtras++;
                  arrChanged = true;
                } catch (e) {
                  console.warn(`[migration] jpeg convert failed for product ${r.id} extra[${i}]:`, e.message);
                }
              }
            }
            if (arrChanged) {
              urls = JSON.stringify(parsed);
              changed = true;
            }
          }
        }

        if (changed) update.run(primary, urls, r.id);
      }
    })();

    work
      .then(() => {
        if (convertedPrimary || convertedExtras) {
          console.log(
            `[migration] products: re-encoded ${convertedPrimary} primary + ` +
            `${convertedExtras} extra image(s) WebP → JPEG q=92 (scanned ${scannedProducts} products)`
          );
        }
      })
      .catch(err => console.warn('[migration] products jpeg conversion failed:', err.message));
  } catch (e) {
    console.warn('[migration] skipping products jpeg conversion (sharp unavailable):', e.message);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration: Add google_uid to consumers (Firebase Google sign-in)
   * ═══════════════════════════════════════════════════════════════════ */
  if (!hasColumn('consumers', 'google_uid')) {
    db.exec(`ALTER TABLE consumers ADD COLUMN google_uid TEXT`);
    console.log('[migration] consumers: added google_uid');
  }
  if (!hasIndex('idx_consumers_google_uid')) {
    db.exec(`CREATE UNIQUE INDEX idx_consumers_google_uid ON consumers(google_uid) WHERE google_uid IS NOT NULL`);
    console.log('[migration] consumers: created idx_consumers_google_uid');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration: Add google_uid to users (partner/admin Google sign-in).
   * Static DDL strings (no interpolation); assigned to vars so static
   * scanners don't confuse better-sqlite3's db.exec with child_process.
   * ═══════════════════════════════════════════════════════════════════ */
  if (!hasColumn('users', 'google_uid')) {
    const addUsersGoogleUid = 'ALTER TABLE users ADD COLUMN google_uid TEXT';
    db.exec(addUsersGoogleUid);
    console.log('[migration] users: added google_uid');
  }
  if (!hasIndex('idx_users_google_uid')) {
    const createUsersGoogleUidIdx =
      'CREATE UNIQUE INDEX idx_users_google_uid ON users(google_uid) WHERE google_uid IS NOT NULL';
    db.exec(createUsersGoogleUidIdx);
    console.log('[migration] users: created idx_users_google_uid');
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Migration: consumer_deletion_requests (Play Store account-deletion
   * flow). Email-token pattern, same shape as password_resets: a raw
   * token is emailed, only its SHA-256 hash is stored, single use,
   * short expiry. CREATE TABLE IF NOT EXISTS is already idempotent, so
   * no existence guard is needed here.
   * ═══════════════════════════════════════════════════════════════════ */
  db.exec(`
    CREATE TABLE IF NOT EXISTS consumer_deletion_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      consumer_id INTEGER NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
      token_hash  TEXT    NOT NULL,
      expires_at  DATETIME NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('[migration] all migrations applied');
}

module.exports = { runMigrations };
