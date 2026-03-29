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

  console.log('[migration] all migrations applied');
}

module.exports = { runMigrations };
