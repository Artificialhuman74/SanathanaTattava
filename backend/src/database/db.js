const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'database.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    email            TEXT    UNIQUE NOT NULL,
    password         TEXT    NOT NULL,
    role             TEXT    NOT NULL DEFAULT 'trader',
    tier             INTEGER,
    referral_code    TEXT    UNIQUE,
    referred_by_id   INTEGER REFERENCES users(id),
    phone            TEXT,
    address          TEXT,
    pincode          TEXT,
    will_deliver     INTEGER NOT NULL DEFAULT 0,
    delivery_enabled INTEGER NOT NULL DEFAULT 0,
    commission_rate  REAL    NOT NULL DEFAULT 10.0,
    status           TEXT    NOT NULL DEFAULT 'active',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT,
    category     TEXT    NOT NULL,
    sku          TEXT    UNIQUE NOT NULL,
    price        REAL    NOT NULL,
    cost_price   REAL,
    stock        INTEGER NOT NULL DEFAULT 0,
    min_stock    INTEGER NOT NULL DEFAULT 10,
    image_url    TEXT,
    unit         TEXT    NOT NULL DEFAULT 'piece',
    status       TEXT    NOT NULL DEFAULT 'active',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT    UNIQUE NOT NULL,
    trader_id    INTEGER NOT NULL REFERENCES users(id),
    status       TEXT    NOT NULL DEFAULT 'pending',
    subtotal     REAL    NOT NULL,
    discount     REAL    NOT NULL DEFAULT 0,
    total_amount REAL    NOT NULL,
    notes        TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity   INTEGER NOT NULL,
    price      REAL    NOT NULL,
    total      REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS consumers (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    email              TEXT UNIQUE,
    password           TEXT,
    phone              TEXT UNIQUE NOT NULL,
    address            TEXT,
    pincode            TEXT,
    referral_code_used TEXT,
    linked_dealer_id   INTEGER REFERENCES users(id),
    status             TEXT NOT NULL DEFAULT 'active',
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* OTP records for consumer phone/email verification */
  CREATE TABLE IF NOT EXISTS consumer_otps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    otp_hash   TEXT    NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* linked_dealer_id is nullable: NULL = direct consumer (no referral), admin handles */
  CREATE TABLE IF NOT EXISTS consumer_orders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number       TEXT    UNIQUE NOT NULL,
    consumer_id        INTEGER NOT NULL REFERENCES consumers(id),
    linked_dealer_id   INTEGER REFERENCES users(id),
    delivery_dealer_id INTEGER REFERENCES users(id),
    is_direct          INTEGER NOT NULL DEFAULT 0,
    status             TEXT    NOT NULL DEFAULT 'pending',
    payment_status     TEXT    NOT NULL DEFAULT 'pending',
    subtotal           REAL    NOT NULL,
    discount_percent   REAL    NOT NULL DEFAULT 0,
    discount_amount    REAL    NOT NULL DEFAULT 0,
    total_amount       REAL    NOT NULL,
    pincode            TEXT    NOT NULL,
    delivery_address   TEXT    NOT NULL,
    notes              TEXT,
    confirmation_sent  INTEGER NOT NULL DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS consumer_order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES consumer_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity   INTEGER NOT NULL,
    price      REAL    NOT NULL,
    total      REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commissions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    trader_id         INTEGER NOT NULL REFERENCES users(id),
    consumer_order_id INTEGER REFERENCES consumer_orders(id),
    amount            REAL    NOT NULL,
    rate              REAL    NOT NULL,
    type              TEXT    NOT NULL DEFAULT 'direct',
    status            TEXT    NOT NULL DEFAULT 'pending',
    week_start        TEXT,
    week_end          TEXT,
    paid_at           DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS weekly_payouts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    trader_id        INTEGER NOT NULL REFERENCES users(id),
    amount           REAL    NOT NULL,
    week_start       TEXT    NOT NULL,
    week_end         TEXT    NOT NULL,
    commission_count INTEGER NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'pending',
    processed_at     DATETIME,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* Admin-configurable platform settings (key-value) */
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* Multiple saved delivery addresses per consumer */
  CREATE TABLE IF NOT EXISTS consumer_addresses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    consumer_id INTEGER NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT 'Home',
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    address    TEXT NOT NULL,
    pincode    TEXT NOT NULL,
    latitude   REAL,
    longitude  REAL,
    h3_index   TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/* Safe column migrations for older databases */
const safeAlter = (sql) => { try { db.exec(sql); } catch (_) {} };
safeAlter(`ALTER TABLE users ADD COLUMN pincode TEXT`);
safeAlter(`ALTER TABLE users ADD COLUMN will_deliver INTEGER NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE users ADD COLUMN delivery_enabled INTEGER NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE users ADD COLUMN commission_rate REAL NOT NULL DEFAULT 10.0`);
safeAlter(`ALTER TABLE consumer_orders ADD COLUMN is_direct INTEGER NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE consumer_orders ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE consumer_orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0`);
/* OTP table — added in v2 */
safeAlter(`ALTER TABLE consumers ADD COLUMN email TEXT UNIQUE`);
safeAlter(`ALTER TABLE consumers ADD COLUMN phone TEXT UNIQUE NOT NULL DEFAULT ''`);
safeAlter(`ALTER TABLE consumers ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1`);
/* Delivery OTP stored in plaintext for in-app display (no SMS) */
safeAlter(`ALTER TABLE consumer_orders ADD COLUMN delivery_otp TEXT`);

/* Email verification tokens (consumers + users) */
db.exec(`CREATE TABLE IF NOT EXISTS email_verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  token_hash TEXT    NOT NULL,
  expires_at DATETIME NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

/* Password reset tokens */
db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  token_hash TEXT    NOT NULL,
  expires_at DATETIME NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

/* Seed default settings if missing */
db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('referral_discount_percent','10')`).run();

/* ── Run idempotent geo / H3 migrations ──────────────────────────────── */
const { runMigrations } = require('./migrations');
runMigrations(db);

module.exports = db;
