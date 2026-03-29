require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed() {
  console.log('🌱 Seeding database…');

  /* DROP all tables so schema changes take full effect */
  db.exec(`PRAGMA foreign_keys = OFF`);
  db.exec(`
    DROP TABLE IF EXISTS inventory_transactions;
    DROP TABLE IF EXISTS dealer_inventory;
    DROP TABLE IF EXISTS weekly_payouts;
    DROP TABLE IF EXISTS commissions;
    DROP TABLE IF EXISTS consumer_order_items;
    DROP TABLE IF EXISTS consumer_orders;
    DROP TABLE IF EXISTS consumer_addresses;
    DROP TABLE IF EXISTS consumer_otps;
    DROP TABLE IF EXISTS consumers;
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS notifications;
  `);
  db.exec(`PRAGMA foreign_keys = ON`);

  /* Re-create with latest schema */
  db.exec(`
    CREATE TABLE users (
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
      will_deliver         INTEGER NOT NULL DEFAULT 0,
      delivery_enabled     INTEGER NOT NULL DEFAULT 0,
      commission_rate      REAL    NOT NULL DEFAULT 10.0,
      latitude             REAL,
      longitude            REAL,
      h3_index             TEXT,
      availability_status  TEXT    NOT NULL DEFAULT 'available',
      status               TEXT    NOT NULL DEFAULT 'active',
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
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
    CREATE TABLE orders (
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
    CREATE TABLE order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity   INTEGER NOT NULL,
      price      REAL    NOT NULL,
      total      REAL    NOT NULL
    );
    CREATE TABLE consumers (
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
    CREATE TABLE consumer_otps (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      phone      TEXT    NOT NULL,
      email      TEXT    NOT NULL,
      otp_hash   TEXT    NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE consumer_orders (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number         TEXT    UNIQUE NOT NULL,
      consumer_id          INTEGER NOT NULL REFERENCES consumers(id),
      linked_dealer_id     INTEGER REFERENCES users(id),
      delivery_dealer_id   INTEGER REFERENCES users(id),
      is_direct            INTEGER NOT NULL DEFAULT 0,
      status               TEXT    NOT NULL DEFAULT 'pending',
      payment_status       TEXT    NOT NULL DEFAULT 'pending',
      subtotal             REAL    NOT NULL,
      discount_percent     REAL    NOT NULL DEFAULT 0,
      discount_amount      REAL    NOT NULL DEFAULT 0,
      total_amount         REAL    NOT NULL,
      pincode              TEXT    NOT NULL,
      delivery_address     TEXT    NOT NULL,
      delivery_latitude    REAL,
      delivery_longitude   REAL,
      delivery_h3_index    TEXT,
      delivery_distance_km REAL,
      assignment_status    TEXT    NOT NULL DEFAULT 'unassigned',
      notes                TEXT,
      confirmation_sent    INTEGER NOT NULL DEFAULT 0,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE consumer_order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES consumer_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity   INTEGER NOT NULL,
      price      REAL    NOT NULL,
      total      REAL    NOT NULL
    );
    CREATE TABLE commissions (
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
    CREATE TABLE weekly_payouts (
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
    CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE consumer_addresses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      consumer_id INTEGER NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
      label       TEXT NOT NULL DEFAULT 'Home',
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL,
      address     TEXT NOT NULL,
      pincode     TEXT NOT NULL,
      latitude    REAL,
      longitude   REAL,
      h3_index    TEXT,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /* ── Settings ──────────────────────────────────────────────────────── */
  db.prepare(`INSERT INTO settings (key,value) VALUES ('referral_discount_percent','10')`).run();

  /* ── Admin ─────────────────────────────────────────────────────────── */
  const adminPw = await bcrypt.hash('Admin@123', 12);
  db.prepare(`INSERT INTO users (name,email,password,role,status) VALUES (?,?,?,'admin','active')`)
    .run('Admin User', 'admin@tradehub.com', adminPw);

  /* ── Tier 1 Parent Dealers – codes: A0000, B0000, C0000 ────────────── */
  const traderPw = await bcrypt.hash('Trader@123', 12);
  const { latLngToH3Index } = require('../services/h3Service');
  const tier1Data = [
    { name: 'Alex Johnson',  email: 'alex@tradehub.com',   phone: '+91-9876540101', address: '12 Market St, Mumbai',     pincode: '400001', code: 'A0000', willDeliver: 1, deliveryEnabled: 1, lat: 19.0760, lng: 72.8777 },
    { name: 'Maria Garcia',  email: 'maria@tradehub.com',  phone: '+91-9876540102', address: '45 Commerce Ave, Delhi',   pincode: '110001', code: 'B0000', willDeliver: 1, deliveryEnabled: 1, lat: 28.6139, lng: 77.2090 },
    { name: 'David Chen',    email: 'david@tradehub.com',  phone: '+91-9876540103', address: '8 Trade Blvd, Bangalore',  pincode: '560001', code: 'C0000', willDeliver: 0, deliveryEnabled: 0, lat: 12.9716, lng: 77.5946 },
  ];
  const tier1Rows = [];
  for (const t of tier1Data) {
    const h3Idx = latLngToH3Index(t.lat, t.lng);
    const r = db.prepare(`
      INSERT INTO users (name,email,password,role,tier,referral_code,phone,address,pincode,will_deliver,delivery_enabled,commission_rate,latitude,longitude,h3_index,availability_status,status)
      VALUES (?,?,?,'trader',1,?,?,?,?,?,?,10.0,?,?,?,'available','active')
    `).run(t.name, t.email, traderPw, t.code, t.phone, t.address, t.pincode, t.willDeliver, t.deliveryEnabled, t.lat, t.lng, h3Idx);
    tier1Rows.push({ id: r.lastInsertRowid, code: t.code, phone: t.phone, letter: t.code[0] });
  }
  const [alexRow, mariaRow, davidRow] = tier1Rows;

  /* ── Tier 2 Sub Dealers – codes: A0001, A0002, B0001, C0001, C0002 ── */
  const tier2Data = [
    { name: 'Sarah Wilson',      email: 'sarah@tradehub.com',    phone: '+91-9876540201', address: '3 Hill Rd, Mumbai',        pincode: '400002', parentId: alexRow.id,  code: 'A0001', commRate: 12.0, willDeliver: 1, deliveryEnabled: 1, lat: 19.0540, lng: 72.8400 },
    { name: 'James Brown',       email: 'james@tradehub.com',    phone: '+91-9876540202', address: '7 Sea Face, Mumbai',       pincode: '400003', parentId: alexRow.id,  code: 'A0002', commRate: 10.0, willDeliver: 0, deliveryEnabled: 0, lat: 19.0178, lng: 72.8478 },
    { name: 'Emma Davis',        email: 'emma@tradehub.com',     phone: '+91-9876540203', address: '22 Lodi Colony, Delhi',    pincode: '110003', parentId: mariaRow.id, code: 'B0001', commRate: 8.0,  willDeliver: 1, deliveryEnabled: 1, lat: 28.5902, lng: 77.2197 },
    { name: 'Michael Taylor',    email: 'michael@tradehub.com',  phone: '+91-9876540204', address: '5 Indiranagar, Bangalore', pincode: '560038', parentId: davidRow.id, code: 'C0001', commRate: 15.0, willDeliver: 1, deliveryEnabled: 1, lat: 12.9784, lng: 77.6408 },
    { name: 'Isabella Martinez', email: 'isabella@tradehub.com', phone: '+91-9876540205', address: '9 Koramangala, Bangalore', pincode: '560034', parentId: davidRow.id, code: 'C0002', commRate: 11.0, willDeliver: 0, deliveryEnabled: 0, lat: 12.9352, lng: 77.6245 },
  ];
  for (const t of tier2Data) {
    const h3Idx = latLngToH3Index(t.lat, t.lng);
    db.prepare(`
      INSERT INTO users (name,email,password,role,tier,referral_code,referred_by_id,phone,address,pincode,will_deliver,delivery_enabled,commission_rate,latitude,longitude,h3_index,availability_status,status)
      VALUES (?,?,?,'trader',2,?,?,?,?,?,?,?,?,?,?,?,'available','active')
    `).run(t.name, t.email, traderPw, t.code, t.parentId, t.phone, t.address, t.pincode, t.willDeliver, t.deliveryEnabled, t.commRate, t.lat, t.lng, h3Idx);
  }

  /* ── Products ──────────────────────────────────────────────────────── */
  const products = [
    { name: 'Premium Wireless Headphones', desc: 'High-quality wireless headphones with ANC and 30h battery.', cat: 'Electronics',     sku: 'ELEC-001', price: 89.99,  cost: 42.00, stock: 150, min: 20, img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&q=80', unit: 'piece' },
    { name: 'Smart Watch Series X',        desc: 'Smartwatch with health monitoring, GPS and 7-day battery.',  cat: 'Electronics',     sku: 'ELEC-002', price: 199.99, cost: 95.00, stock: 80,  min: 15, img: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80', unit: 'piece' },
    { name: 'Portable Bluetooth Speaker',  desc: 'IPX7 Bluetooth 5.0 speaker with 360° surround sound.',      cat: 'Electronics',     sku: 'ELEC-003', price: 59.99,  cost: 27.00, stock: 160, min: 25, img: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=500&q=80', unit: 'piece' },
    { name: 'Mechanical Keyboard RGB',     desc: 'TKL keyboard with Cherry MX switches and per-key RGB.',      cat: 'Electronics',     sku: 'ELEC-004', price: 129.99, cost: 63.00, stock: 75,  min: 10, img: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500&q=80', unit: 'piece' },
    { name: 'Laptop Backpack Pro',         desc: 'Water-resistant 30L backpack with USB port & anti-theft.',    cat: 'Accessories',     sku: 'ACC-001',  price: 49.99,  cost: 22.00, stock: 200, min: 30, img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&q=80', unit: 'piece' },
    { name: 'Phone Stand & Holder',        desc: 'Adjustable aluminium stand for phones and tablets.',           cat: 'Accessories',     sku: 'ACC-002',  price: 16.99,  cost: 6.50,  stock: 300, min: 40, img: 'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=500&q=80', unit: 'piece' },
    { name: 'Tote Shopping Bag',           desc: 'Eco-friendly canvas tote with zip pocket.',                    cat: 'Accessories',     sku: 'ACC-003',  price: 14.99,  cost: 5.50,  stock: 350, min: 50, img: 'https://images.unsplash.com/photo-1591085686350-798c0f9faa7f?w=500&q=80', unit: 'piece' },
    { name: 'Organic Coffee Blend',        desc: 'Single-origin organic coffee beans, medium roast.',            cat: 'Food & Beverage', sku: 'FB-001',   price: 24.99,  cost: 11.00, stock: 500, min: 60, img: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=500&q=80', unit: 'kg' },
    { name: 'Organic Green Tea',           desc: 'Japanese loose-leaf green tea, 200g tin.',                     cat: 'Food & Beverage', sku: 'FB-002',   price: 19.99,  cost: 8.50,  stock: 280, min: 40, img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&q=80', unit: 'tin' },
    { name: 'Stainless Steel Water Bottle', desc: 'Double-wall insulated 750ml. Cold 24h / Hot 12h.',           cat: 'Lifestyle',       sku: 'LS-001',   price: 29.99,  cost: 12.00, stock: 300, min: 40, img: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=500&q=80', unit: 'piece' },
    { name: 'Scented Candle Set',          desc: 'Set of 3 soy wax candles: Lavender, Vanilla, Sandalwood.',    cat: 'Lifestyle',       sku: 'LS-002',   price: 36.99,  cost: 16.00, stock: 160, min: 25, img: 'https://images.unsplash.com/photo-1603905230641-2e07a11de4f3?w=500&q=80', unit: 'set' },
    { name: 'Yoga Mat Premium',            desc: 'Non-slip TPE yoga mat with alignment lines and carry strap.',  cat: 'Sports & Fitness', sku: 'SF-001',  price: 39.99,  cost: 17.50, stock: 180, min: 25, img: 'https://images.unsplash.com/photo-1601925228002-e1c7a0db72dc?w=500&q=80', unit: 'piece' },
    { name: 'Resistance Bands Set',        desc: 'Set of 5 latex resistance bands, 5–50 lbs + carry bag.',      cat: 'Sports & Fitness', sku: 'SF-002',  price: 19.99,  cost: 7.50,  stock: 250, min: 35, img: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=500&q=80', unit: 'set' },
    { name: 'Running Shoes Pro',           desc: 'Lightweight mesh running shoes with foam cushioning.',         cat: 'Sports & Fitness', sku: 'SF-003',  price: 89.99,  cost: 40.00, stock: 90,  min: 15, img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&q=80', unit: 'pair' },
    { name: 'LED Desk Lamp',               desc: 'Touch LED lamp, 5 brightness levels, USB port.',              cat: 'Home & Office',   sku: 'HO-001',   price: 34.99,  cost: 15.50, stock: 120, min: 20, img: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500&q=80', unit: 'piece' },
    { name: 'Ceramic Coffee Mug Set',      desc: 'Set of 4 stoneware mugs, microwave & dishwasher safe.',        cat: 'Home & Office',   sku: 'HO-002',   price: 32.99,  cost: 14.00, stock: 200, min: 30, img: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=500&q=80', unit: 'set' },
    { name: 'Essential Oil Diffuser',      desc: '300ml ultrasonic diffuser, 7 LED colours, auto-shutoff.',      cat: 'Home & Office',   sku: 'HO-003',   price: 27.99,  cost: 12.00, stock: 140, min: 20, img: 'https://images.unsplash.com/photo-1608571423539-e951a406e170?w=500&q=80', unit: 'piece' },
    { name: 'Wooden Cutting Board',        desc: 'Large bamboo board with juice groove and non-slip feet.',      cat: 'Kitchen',         sku: 'KIT-001',  price: 22.99,  cost: 9.00,  stock: 220, min: 30, img: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?w=500&q=80', unit: 'piece' },
    { name: 'Natural Skincare Set',        desc: 'Cleanser, toner, vitamin C serum & moisturiser set.',          cat: 'Beauty & Care',   sku: 'BC-001',   price: 79.99,  cost: 34.00, stock: 100, min: 15, img: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&q=80', unit: 'set' },
    { name: 'Vitamin C Supplement',        desc: '1000mg Vitamin C with Rose Hips. 90 veg tablets.',             cat: 'Health',          sku: 'HLT-001',  price: 18.99,  cost: 8.00,  stock: 400, min: 50, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80', unit: 'bottle' },
  ];
  const insProd = db.prepare(`INSERT INTO products (name,description,category,sku,price,cost_price,stock,min_stock,image_url,unit,status) VALUES (?,?,?,?,?,?,?,?,?,?,'active')`);
  for (const p of products) insProd.run(p.name, p.desc, p.cat, p.sku, p.price, p.cost, p.stock, p.min, p.img, p.unit);

  /* ── Trader B2B Orders ─────────────────────────────────────────────── */
  const traders  = db.prepare(`SELECT id FROM users WHERE role='trader'`).all();
  const allProds = db.prepare(`SELECT id, price FROM products`).all();
  const bStatuses = ['pending','confirmed','processing','shipped','delivered'];
  let oIdx = 1;
  for (const trader of traders.slice(0, 5)) {
    for (let i = 0; i < 3; i++) {
      let sub = 0; const items = [];
      const n = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < n; j++) {
        const pr = allProds[Math.floor(Math.random() * allProds.length)];
        const q  = Math.floor(Math.random() * 5) + 1;
        items.push({ pid: pr.id, q, price: pr.price, tot: pr.price * q }); sub += pr.price * q;
      }
      const st  = bStatuses[Math.floor(Math.random() * bStatuses.length)];
      const num = `ORD-${String(oIdx++).padStart(5,'0')}`;
      const or  = db.prepare(`INSERT INTO orders (order_number,trader_id,status,subtotal,discount,total_amount) VALUES (?,?,?,?,0,?)`).run(num, trader.id, st, sub, sub);
      const iiS = db.prepare(`INSERT INTO order_items (order_id,product_id,quantity,price,total) VALUES (?,?,?,?,?)`);
      for (const it of items) iiS.run(or.lastInsertRowid, it.pid, it.q, it.price, it.tot);
    }
  }

  /* ── Consumers ─────────────────────────────────────────────────────── */
  const byCode = (code) => db.prepare(`SELECT * FROM users WHERE referral_code=?`).get(code);
  const dA0 = byCode('A0000'), dB0 = byCode('B0000'), dC0 = byCode('C0000');
  const dA1 = byCode('A0001'), dB1 = byCode('B0001'), dC1 = byCode('C0001');

  const consumersData = [
    /* With referral codes — lat/lng approximate for H3 matching */
    { name: 'Riya Sharma',    email: 'riya@example.com',    phone: '+91-9800000001', address: '1 Bandra West, Mumbai',       pincode: '400050', code: 'A0000', dealer: dA0, lat: 19.0596, lng: 72.8295 },
    { name: 'Karan Mehta',    email: 'karan@example.com',   phone: '+91-9800000002', address: '22 Andheri East, Mumbai',      pincode: '400069', code: 'A0000', dealer: dA0, lat: 19.1136, lng: 72.8697 },
    { name: 'Priya Nair',     email: 'priya@example.com',   phone: '+91-9800000003', address: '5 Connaught Place, Delhi',     pincode: '110001', code: 'B0000', dealer: dB0, lat: 28.6315, lng: 77.2167 },
    { name: 'Rahul Gupta',    email: 'rahul@example.com',   phone: '+91-9800000004', address: '9 Hauz Khas, Delhi',           pincode: '110016', code: 'B0000', dealer: dB0, lat: 28.5494, lng: 77.2001 },
    { name: 'Ananya Reddy',   email: 'ananya@example.com',  phone: '+91-9800000005', address: '12 Whitefield, Bangalore',     pincode: '560066', code: 'C0000', dealer: dC0, lat: 12.9698, lng: 77.7500 },
    { name: 'Vikram Singh',   email: 'vikram@example.com',  phone: '+91-9800000006', address: '3 Juhu Beach, Mumbai',         pincode: '400049', code: 'A0001', dealer: dA1, lat: 19.0988, lng: 72.8267 },
    { name: 'Sneha Patel',    email: 'sneha@example.com',   phone: '+91-9800000007', address: '8 Dadar, Mumbai',              pincode: '400014', code: 'A0001', dealer: dA1, lat: 19.0176, lng: 72.8562 },
    { name: 'Amit Kumar',     email: 'amit@example.com',    phone: '+91-9800000008', address: '15 Karol Bagh, Delhi',         pincode: '110005', code: 'B0001', dealer: dB1, lat: 28.6519, lng: 77.1909 },
    { name: 'Nisha Verma',    email: 'nisha@example.com',   phone: '+91-9800000009', address: '7 Koramangala 4th, Bangalore', pincode: '560034', code: 'C0001', dealer: dC1, lat: 12.9352, lng: 77.6245 },
    { name: 'Rohit Joshi',    email: 'rohit@example.com',   phone: '+91-9800000010', address: '20 MG Road, Bangalore',        pincode: '560001', code: 'C0001', dealer: dC1, lat: 12.9716, lng: 77.5946 },
    /* Direct consumers (NO referral code) – admin handles */
    { name: 'Pooja Das',      email: 'pooja@example.com',   phone: '+91-9800000011', address: '33 Salt Lake, Kolkata',        pincode: '700064', code: null,     dealer: null, lat: 22.5726, lng: 88.3639 },
    { name: 'Sanjay Yadav',   email: 'sanjay@example.com',  phone: '+91-9800000012', address: '4 Marine Drive, Mumbai',       pincode: '400020', code: null,     dealer: null, lat: 18.9441, lng: 72.8234 },
    { name: 'Meera Iyer',     email: 'meera@example.com',   phone: '+91-9800000013', address: '18 Adyar, Chennai',            pincode: '600020', code: null,     dealer: null, lat: 13.0012, lng: 80.2565 },
  ];
  const insCons = db.prepare(`INSERT INTO consumers (name,email,phone,address,pincode,referral_code_used,linked_dealer_id,status) VALUES (?,?,?,?,?,?,?,'active')`);
  const insAddr = db.prepare(`INSERT INTO consumer_addresses (consumer_id,label,name,phone,address,pincode,is_default,latitude,longitude,h3_index) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const consumerRows = [];
  for (const c of consumersData) {
    const r = insCons.run(c.name, c.email, c.phone, c.address, c.pincode, c.code, c.dealer?.id ?? null);
    const cid = r.lastInsertRowid;
    consumerRows.push({ id: cid, dealer: c.dealer, pincode: c.pincode, address: c.address, isDirect: !c.dealer, lat: c.lat, lng: c.lng });
    /* Seed a default Home address with lat/lng/h3 for H3 matching */
    const addrH3 = c.lat && c.lng ? latLngToH3Index(c.lat, c.lng) : null;
    insAddr.run(cid, 'Home', c.name, c.phone, c.address, c.pincode, 1, c.lat || null, c.lng || null, addrH3);
  }
  /* Seed a second Work address for the first two consumers */
  const workH3_1 = latLngToH3Index(19.0760, 72.8777); // near Mumbai market
  const workH3_2 = latLngToH3Index(19.1000, 72.8800); // Andheri business district
  insAddr.run(consumerRows[0].id, 'Work', consumersData[0].name, consumersData[0].phone, '456 Office Park, Mumbai', '400001', 0, 19.0760, 72.8777, workH3_1);
  insAddr.run(consumerRows[1].id, 'Work', consumersData[1].name, consumersData[1].phone, '789 Business District, Mumbai', '400002', 0, 19.1000, 72.8800, workH3_2);
  console.log('📍 Seeded consumer addresses with lat/lng + H3 indexes');

  /* ── Consumer Orders + Commissions ────────────────────────────────── */
  const DISCOUNT_PCT = 10; // matches settings seed
  const cStatuses = ['pending','confirmed','processing','shipped','delivered'];
  const cPayStat  = ['pending','paid','paid','paid','paid'];
  let coIdx = 1;
  const allComms = [];

  const insCO  = db.prepare(`INSERT INTO consumer_orders (order_number,consumer_id,linked_dealer_id,delivery_dealer_id,is_direct,status,payment_status,subtotal,discount_percent,discount_amount,total_amount,pincode,delivery_address,confirmation_sent,delivery_latitude,delivery_longitude,delivery_h3_index,delivery_distance_km,assignment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`);
  const insCOI = db.prepare(`INSERT INTO consumer_order_items (order_id,product_id,quantity,price,total) VALUES (?,?,?,?,?)`);
  const { findNearestDealer: seedFindNearest } = require('../services/deliveryAssignment');
  const { haversineDistance: seedHaversine }    = require('../services/h3Service');

  for (const cr of consumerRows) {
    const dealer = cr.dealer ? db.prepare(`SELECT * FROM users WHERE id=?`).get(cr.dealer.id) : null;
    const isDirect = cr.isDirect ? 1 : 0;
    const discPct = dealer ? DISCOUNT_PCT : 0; // only referral consumers get discount

    // Use H3 spatial search to find nearest delivery dealer (like real order flow)
    let deliveryDealerId = null, deliveryDistKm = null, deliveryH3 = null;
    if (cr.lat && cr.lng) {
      deliveryH3 = latLngToH3Index(cr.lat, cr.lng);
      try {
        const nearest = seedFindNearest(cr.lat, cr.lng);
        if (nearest) {
          deliveryDealerId = nearest.dealer.id;
          deliveryDistKm = nearest.distanceKm;
        }
      } catch (e) { /* fallback below */ }
    }
    // Fallback: linked dealer if delivery-enabled
    if (!deliveryDealerId && dealer?.will_deliver && dealer?.delivery_enabled) {
      deliveryDealerId = dealer.id;
      if (cr.lat && cr.lng && dealer.latitude && dealer.longitude) {
        deliveryDistKm = parseFloat(seedHaversine(cr.lat, cr.lng, dealer.latitude, dealer.longitude).toFixed(3));
      }
    }
    const assignStatus = deliveryDealerId ? 'assigned' : 'unassigned';

    for (let i = 0; i < 2; i++) {
      let sub = 0; const items = [];
      const n = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < n; j++) {
        const pr = allProds[Math.floor(Math.random() * allProds.length)];
        const q  = Math.floor(Math.random() * 3) + 1;
        items.push({ pid: pr.id, q, price: pr.price, tot: pr.price * q }); sub += pr.price * q;
      }
      const si       = Math.floor(Math.random() * cStatuses.length);
      const discAmt  = parseFloat((sub * discPct / 100).toFixed(2));
      const total    = parseFloat((sub - discAmt).toFixed(2));
      const num      = `CORD-${String(coIdx++).padStart(5,'0')}`;
      const cor = insCO.run(num, cr.id, dealer?.id ?? null, deliveryDealerId, isDirect, cStatuses[si], cPayStat[si], sub, discPct, discAmt, total, cr.pincode, cr.address, cr.lat || null, cr.lng || null, deliveryH3, deliveryDistKm, assignStatus);
      for (const it of items) insCOI.run(cor.lastInsertRowid, it.pid, it.q, it.price, it.tot);

      if (dealer && ['delivered','shipped','processing'].includes(cStatuses[si])) {
        // Commission goes to linked (referral) dealer, not delivery dealer
        allComms.push({ tid: dealer.id, oid: cor.lastInsertRowid, amt: +(total * dealer.commission_rate / 100).toFixed(2), rate: dealer.commission_rate, type: 'direct' });
        if (dealer.tier === 2 && dealer.referred_by_id) {
          const parent = db.prepare(`SELECT * FROM users WHERE id=?`).get(dealer.referred_by_id);
          if (parent) allComms.push({ tid: parent.id, oid: cor.lastInsertRowid, amt: +(total * parent.commission_rate / 100).toFixed(2), rate: parent.commission_rate, type: 'override' });
        }
      }
    }
  }

  const insComm = db.prepare(`INSERT INTO commissions (trader_id,consumer_order_id,amount,rate,type,status,week_start,week_end,paid_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  const weekOf = (n) => {
    const d = new Date('2026-03-12'); d.setDate(d.getDate() - n * 7);
    const e = d.toISOString().slice(0,10);
    const s = new Date(d); s.setDate(s.getDate()-6);
    return { s: s.toISOString().slice(0,10), e };
  };
  const weeks = [weekOf(0), weekOf(1), weekOf(2)];
  allComms.forEach((c, i) => {
    const w = weeks[i % 3]; const paid = i % 3 !== 0;
    insComm.run(c.tid, c.oid, c.amt, c.rate, c.type, paid?'paid':'pending', w.s, w.e, paid?new Date(w.e+'T12:00:00Z').toISOString():null);
  });

  /* ── Create H3 index for fast spatial queries ────────────────────── */
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_h3 ON users(h3_index)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_availability ON users(availability_status, delivery_enabled, will_deliver)`);

  /* ── Dealer Inventory ────────────────────────────────────────────── */
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
    );
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id     INTEGER NOT NULL REFERENCES users(id),
      product_id    INTEGER NOT NULL REFERENCES products(id),
      quantity      INTEGER NOT NULL,
      type          TEXT    NOT NULL,
      reference_id  INTEGER,
      notes         TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dealer_inv_dealer ON dealer_inventory(dealer_id);
    CREATE INDEX IF NOT EXISTS idx_dealer_inv_product ON dealer_inventory(product_id);
  `);

  /* Give each delivery-enabled dealer stock of all products */
  const deliveryDealers = db.prepare(`SELECT id, name FROM users WHERE role='trader' AND delivery_enabled=1 AND will_deliver=1`).all();
  const insInv = db.prepare(`INSERT INTO dealer_inventory (dealer_id, product_id, quantity, low_stock_threshold, last_restocked_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`);
  const insInvTx = db.prepare(`INSERT INTO inventory_transactions (dealer_id, product_id, quantity, type, notes) VALUES (?, ?, ?, 'restock', ?)`);

  for (const dealer of deliveryDealers) {
    for (const prod of allProds) {
      const qty = Math.floor(Math.random() * 15) + 5;  // 5–20 units each
      const threshold = Math.floor(Math.random() * 3) + 2; // 2–4 threshold
      insInv.run(dealer.id, prod.id, qty, threshold);
      insInvTx.run(dealer.id, prod.id, qty, `Initial stock from seed`);
      // Deduct from warehouse
      db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(qty, prod.id);
    }
  }
  console.log(`📦 Seeded dealer inventory for ${deliveryDealers.length} delivery-enabled dealers`);

  /* ── Seed sample notifications for routed orders ───────────────────── */
  // The notifications table is created by notificationService on import — ensure it exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_type   TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      title       TEXT    NOT NULL,
      body        TEXT    NOT NULL,
      data        TEXT,
      channel     TEXT    NOT NULL DEFAULT 'in_app',
      read        INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_type, user_id, read)`);

  const insNotif = db.prepare(`INSERT INTO notifications (user_type, user_id, title, body, data, channel, created_at) VALUES (?,?,?,?,?,?,?)`);
  // Check which orders have delivery_dealer_id != linked_dealer_id (routed to different dealer)
  const routedOrders = db.prepare(`
    SELECT co.order_number, co.linked_dealer_id, co.delivery_dealer_id, co.delivery_distance_km,
           c.name as consumer_name, u1.name as linked_name, u2.name as delivery_name
    FROM consumer_orders co
    JOIN consumers c ON co.consumer_id = c.id
    LEFT JOIN users u1 ON co.linked_dealer_id = u1.id
    LEFT JOIN users u2 ON co.delivery_dealer_id = u2.id
    WHERE co.linked_dealer_id IS NOT NULL
      AND co.delivery_dealer_id IS NOT NULL
      AND co.linked_dealer_id != co.delivery_dealer_id
    GROUP BY co.linked_dealer_id, co.delivery_dealer_id
  `).all();

  for (let i = 0; i < routedOrders.length; i++) {
    const ro = routedOrders[i];
    // Stagger timestamps: most recent first (1 min, 3 min, 8 min, 20 min ago, etc.)
    const minutesAgo = [1, 3, 8, 20, 45, 90, 180, 360][i] || (i * 30 + 5);
    const ts = new Date(Date.now() - minutesAgo * 60000).toISOString();

    // Notify linked dealer about routing
    const title = `Order routed to nearest dealer — ${ro.order_number}`;
    const body  = `Your consumer ${ro.consumer_name}'s order has been assigned to ${ro.delivery_name} (${(ro.delivery_distance_km || 0).toFixed(1)} km from delivery address) for delivery. You still earn commission on this order.`;
    const data  = JSON.stringify({ orderNumber: ro.order_number, deliveryDealerName: ro.delivery_name, distanceKm: ro.delivery_distance_km });
    insNotif.run('dealer', ro.linked_dealer_id, title, body, data, 'in_app', ts);

    // Notify delivery dealer about assignment
    const title2 = `New delivery assigned — ${ro.order_number}`;
    const body2  = `Deliver to ${ro.consumer_name} (${(ro.delivery_distance_km || 0).toFixed(1)} km away).`;
    insNotif.run('dealer', ro.delivery_dealer_id, title2, body2, data, 'in_app', ts);
  }
  if (routedOrders.length > 0) {
    console.log(`🔔 Seeded ${routedOrders.length * 2} notifications for routed orders`);
  }

  console.log('\n✅ Seed complete!\n');
  console.log('Settings:    referral_discount_percent = 10%');
  console.log('Admin:       admin@tradehub.com  /  Admin@123');
  console.log('Tier 1:      alex(A0000 Mumbai) maria(B0000 Delhi) david(C0000 Bangalore)  /  Trader@123');
  console.log('Sub Dealer:  sarah(A0001) james(A0002) emma(B0001) michael(C0001) isabella(C0002)  /  Trader@123');
  console.log('📍 All dealers seeded with lat/lng + H3 indexes for spatial delivery assignment');
  console.log('Consumer (referral):  riya/karan/priya/rahul/ananya/vikram/sneha/amit/nisha/rohit @example.com  /  OTP-based login');
  console.log('Consumer (direct):    pooja/sanjay/meera @example.com  /  OTP-based login\n');
  console.log('💡 OTP login: POST /api/auth/consumer/send-otp with {phone, email}');
  console.log('   Then:      POST /api/auth/consumer/verify-otp with {phone, otp}');
}

seed().catch(err => { console.error(err); process.exit(1); });
