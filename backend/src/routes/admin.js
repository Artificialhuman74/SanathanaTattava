const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { emitOrderUpdate } = require('../websocket/socketServer');
const {
  restockDealer,
  getInventoryOverview,
  getWarehouseInventory,
  getDealerInventory,
  getAllLowStockAlerts,
  updateThreshold,
} = require('../services/inventoryService');

const router = express.Router();
router.use(authenticate, requireAdmin);

/* ── Dashboard Stats ─────────────────────────────────────────────────── */
router.get('/stats', (req, res) => {
  const totalTraders   = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='trader'`).get().c;
  const tier1Traders   = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='trader' AND tier=1`).get().c;
  const tier2Traders   = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='trader' AND tier=2`).get().c;
  const totalConsumers = db.prepare(`SELECT COUNT(*) as c FROM consumers`).get().c;
  const totalProducts  = db.prepare(`SELECT COUNT(*) as c FROM products WHERE status='active'`).get().c;
  const lowStock       = db.prepare(`SELECT COUNT(*) as c FROM products WHERE stock <= min_stock AND status='active'`).get().c;
  const totalOrders    = db.prepare(`SELECT COUNT(*) as c FROM orders`).get().c;
  const totalCOrders   = db.prepare(`SELECT COUNT(*) as c FROM consumer_orders`).get().c;
  const revenue        = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM orders WHERE status='delivered'`).get().s;
  const cRevenue       = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM consumer_orders WHERE status='delivered'`).get().s;
  const pendingComm    = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM commissions WHERE status='pending'`).get().s;
  const pendingOrders  = db.prepare(`SELECT COUNT(*) as c FROM consumer_orders WHERE status='pending'`).get().c;

  const recentCOrders = db.prepare(`
    SELECT co.*, c.name as consumer_name, c.phone as consumer_phone,
           u.name as dealer_name, u.tier as dealer_tier
    FROM consumer_orders co
    JOIN consumers c   ON co.consumer_id = c.id
    LEFT JOIN users u  ON co.linked_dealer_id = u.id
    ORDER BY co.created_at DESC LIMIT 8
  `).all();

  const categoryStats = db.prepare(`
    SELECT category, COUNT(*) as count, SUM(stock) as total_stock
    FROM products WHERE status='active' GROUP BY category
  `).all();

  res.json({ totalTraders, tier1Traders, tier2Traders, totalConsumers, totalProducts, lowStock,
             totalOrders, totalCOrders, revenue, cRevenue, pendingComm, pendingOrders,
             recentCOrders, categoryStats });
});

/* ── Products ─────────────────────────────────────────────────────────── */
router.get('/products', (req, res) => {
  const { search, category, status } = req.query;
  let sql = `SELECT * FROM products WHERE 1=1`, params = [];
  if (search)   { sql += ` AND (name LIKE ? OR sku LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (status)   { sql += ` AND status = ?`;   params.push(status); }
  sql += ` ORDER BY created_at DESC`;
  const products   = db.prepare(sql).all(...params);
  const categories = db.prepare(`SELECT DISTINCT category FROM products ORDER BY category`).all().map(r => r.category);
  res.json({ products, categories });
});

router.post('/products', [
  body('name').trim().notEmpty(),
  body('category').trim().notEmpty(),
  body('sku').trim().notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('stock').isInt({ min: 0 }),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  const { name, description, category, sku, price, cost_price, stock, min_stock, image_url, image_urls, unit } = req.body;
  if (db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku)) return res.status(409).json({ error: 'SKU already exists' });
  const result = db.prepare(`
    INSERT INTO products (name,description,category,sku,price,cost_price,stock,min_stock,image_url,image_urls,unit,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'active')
  `).run(name, description||null, category, sku, price, cost_price||null, stock||0, min_stock||10, image_url||null, image_urls||null, unit||'piece');
  res.status(201).json({ product: db.prepare(`SELECT * FROM products WHERE id = ?`).get(result.lastInsertRowid) });
});

router.put('/products/:id', (req, res) => {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const { name, description, category, sku, price, cost_price, stock, min_stock, image_url, image_urls, unit, status } = req.body;
  if (sku && sku !== product.sku && db.prepare(`SELECT id FROM products WHERE sku = ? AND id != ?`).get(sku, product.id))
    return res.status(409).json({ error: 'SKU already in use' });
  db.prepare(`
    UPDATE products SET name=?,description=?,category=?,sku=?,price=?,cost_price=?,stock=?,min_stock=?,image_url=?,image_urls=?,unit=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(name??product.name, description??product.description, category??product.category, sku??product.sku,
         price??product.price, cost_price??product.cost_price, stock??product.stock, min_stock??product.min_stock,
         image_url??product.image_url, image_urls??product.image_urls, unit??product.unit, status??product.status, product.id);
  res.json({ product: db.prepare(`SELECT * FROM products WHERE id = ?`).get(product.id) });
});

router.delete('/products/:id', (req, res) => {
  if (!db.prepare(`SELECT id FROM products WHERE id = ?`).get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE products SET status='inactive' WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

/* ── Traders ──────────────────────────────────────────────────────────── */
router.get('/traders', (req, res) => {
  const { tier, status, search } = req.query;
  let sql = `
    SELECT u.*, r.name as referrer_name, r.referral_code as referrer_code, r.phone as referrer_phone,
      (SELECT COUNT(*) FROM users sub WHERE sub.referred_by_id = u.id) as sub_count,
      (SELECT COUNT(*) FROM orders o WHERE o.trader_id = u.id) as order_count,
      (SELECT COUNT(*) FROM consumer_orders co WHERE co.linked_dealer_id = u.id) as consumer_order_count,
      (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE trader_id = u.id AND status='pending') as pending_commission
    FROM users u
    LEFT JOIN users r ON u.referred_by_id = r.id
    WHERE u.role = 'trader'
  `, params = [];
  if (tier)   { sql += ` AND u.tier = ?`;       params.push(Number(tier)); }
  if (status) { sql += ` AND u.status = ?`;     params.push(status); }
  if (search) { sql += ` AND (u.name LIKE ? OR u.email LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY u.tier ASC, u.created_at DESC`;
  const traders = db.prepare(sql).all(...params);
  traders.forEach(t => delete t.password);
  res.json({ traders });
});

router.put('/traders/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active','suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (!db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'trader'`).get(req.params.id)) return res.status(404).json({ error: 'Trader not found' });
  db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, req.params.id);
  res.json({ success: true });
});

router.put('/traders/:id/delivery', (req, res) => {
  // Accept `enabled` (new) or `delivery_enabled` (legacy)
  const val = req.body.enabled ?? req.body.delivery_enabled;
  if (typeof val === 'undefined') return res.status(400).json({ error: 'enabled required' });
  if (!db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'trader'`).get(req.params.id)) return res.status(404).json({ error: 'Trader not found' });
  const flag = val ? 1 : 0;
  db.prepare(`UPDATE users SET will_deliver = ?, delivery_enabled = ? WHERE id = ?`).run(flag, flag, req.params.id);
  res.json({ success: true });
});

router.put('/traders/:id/commission-rate', (req, res) => {
  const { commission_rate } = req.body;
  if (commission_rate === undefined || isNaN(commission_rate)) return res.status(400).json({ error: 'Valid commission_rate required' });
  const trader = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'trader'`).get(req.params.id);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  db.prepare(`UPDATE users SET commission_rate = ? WHERE id = ?`).run(Number(commission_rate), req.params.id);
  res.json({ success: true });
});

/* ── Trader B2B Orders ────────────────────────────────────────────────── */
router.get('/orders', (req, res) => {
  const { status, search } = req.query;
  let sql = `SELECT o.*, u.name as trader_name, u.email as trader_email, u.tier FROM orders o JOIN users u ON o.trader_id = u.id WHERE 1=1`, params = [];
  if (status) { sql += ` AND o.status = ?`; params.push(status); }
  if (search) { sql += ` AND (o.order_number LIKE ? OR u.name LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY o.created_at DESC`;
  res.json({ orders: db.prepare(sql).all(...params) });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT o.*, u.name as trader_name, u.email as trader_email, u.phone as trader_phone, u.tier FROM orders o JOIN users u ON o.trader_id = u.id WHERE o.id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare(`SELECT oi.*, p.name as product_name, p.sku, p.image_url, p.unit FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`).all(order.id);
  res.json({ order, items });
});

router.put('/orders/:id/status', (req, res) => {
  const valid = ['pending','confirmed','processing','shipped','delivered','cancelled'];
  const { status } = req.body;
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (!db.prepare(`SELECT id FROM orders WHERE id = ?`).get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, req.params.id);
  res.json({ success: true });
});

/* ── Consumer Orders ──────────────────────────────────────────────────── */
router.get('/consumer-orders', (req, res) => {
  const { status, payment_status, search } = req.query;
  let sql = `
    SELECT co.*, c.name as consumer_name, c.phone as consumer_phone,
           u.name as dealer_name, u.tier as dealer_tier, u.phone as dealer_phone,
           d2.name as delivery_dealer_name
    FROM consumer_orders co
    JOIN consumers c   ON co.consumer_id = c.id
    LEFT JOIN users u  ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    WHERE 1=1
  `, params = [];
  if (status)         { sql += ` AND co.status = ?`;         params.push(status); }
  if (payment_status) { sql += ` AND co.payment_status = ?`; params.push(payment_status); }
  if (search)         { sql += ` AND (co.order_number LIKE ? OR c.name LIKE ? OR u.name LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ` ORDER BY co.created_at DESC`;
  const orders = db.prepare(sql).all(...params);

  /* Attach items with product details */
  const stmtItems = db.prepare(`
    SELECT oi.*, p.name as product_name, p.sku, p.image_url, p.unit
    FROM consumer_order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `);
  for (const o of orders) {
    const items = stmtItems.all(o.id);
    o.items = items;
    o.item_count = items.length;
  }

  res.json({ orders });
});

router.get('/consumer-orders/:id', (req, res) => {
  const order = db.prepare(`
    SELECT co.*, c.name as consumer_name, c.phone as consumer_phone, c.email as consumer_email,
           u.name as dealer_name, u.phone as dealer_phone, u.tier as dealer_tier,
           d2.name as delivery_dealer_name, d2.phone as delivery_dealer_phone,
           p.name as parent_dealer_name, p.phone as parent_dealer_phone
    FROM consumer_orders co
    JOIN consumers c   ON co.consumer_id = c.id
    LEFT JOIN users u  ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    LEFT JOIN users p  ON (u.tier=2 AND u.referred_by_id = p.id)
    WHERE co.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare(`SELECT oi.*, p.name as product_name, p.sku, p.image_url, p.unit FROM consumer_order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`).all(order.id);
  const commissions = db.prepare(`SELECT cm.*, u.name as trader_name FROM commissions cm JOIN users u ON cm.trader_id = u.id WHERE cm.consumer_order_id = ?`).all(order.id);
  res.json({ order, items, commissions });
});

router.put('/consumer-orders/:id/status', (req, res) => {
  const valid = ['pending','confirmed','processing','shipped','delivered','cancelled'];
  const { status, payment_status } = req.body;
  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (status && !valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (status)         db.prepare(`UPDATE consumer_orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, req.params.id);
  if (payment_status) db.prepare(`UPDATE consumer_orders SET payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(payment_status, req.params.id);

  if (status) {
    emitOrderUpdate({
      orderId: order.id, orderNumber: order.order_number,
      status, deliveryStatus: order.delivery_status,
      consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
      deliveryDealerId: order.delivery_dealer_id,
    });
  }

  res.json({ success: true });
});

router.put('/consumer-orders/:id/delivery', (req, res) => {
  const { delivery_dealer_id } = req.body;
  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (delivery_dealer_id) {
    const dealer = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'trader' AND delivery_enabled = 1`).get(delivery_dealer_id);
    if (!dealer) return res.status(400).json({ error: 'Dealer not eligible for delivery' });
  }
  db.prepare(`UPDATE consumer_orders SET delivery_dealer_id=? WHERE id=?`).run(delivery_dealer_id||null, req.params.id);
  res.json({ success: true });
});

/* ── Commissions ──────────────────────────────────────────────────────── */
router.get('/commissions', (req, res) => {
  const { status, trader_id } = req.query;
  let sql = `
    SELECT cm.*, u.name as trader_name, u.tier as trader_tier,
           co.order_number as consumer_order_number, co.total_amount as order_amount
    FROM commissions cm
    JOIN users u ON cm.trader_id = u.id
    LEFT JOIN consumer_orders co ON cm.consumer_order_id = co.id
    WHERE 1=1
  `, params = [];
  if (status)    { sql += ` AND cm.status = ?`;    params.push(status); }
  if (trader_id) { sql += ` AND cm.trader_id = ?`; params.push(Number(trader_id)); }
  sql += ` ORDER BY cm.created_at DESC`;
  res.json({ commissions: db.prepare(sql).all(...params) });
});

router.get('/commissions/summary', (req, res) => {
  const summary = db.prepare(`
    SELECT u.id as dealer_id, u.name as dealer_name, u.tier as dealer_tier, u.commission_rate,
      COUNT(cm.id) as total_commissions,
      COALESCE(SUM(CASE WHEN cm.status='pending' THEN cm.amount END), 0) as pending_amount,
      COALESCE(SUM(CASE WHEN cm.status='paid'    THEN cm.amount END), 0) as paid_amount,
      COALESCE(SUM(cm.amount), 0) as total_amount
    FROM users u
    LEFT JOIN commissions cm ON cm.trader_id = u.id
    WHERE u.role = 'trader'
    GROUP BY u.id ORDER BY pending_amount DESC
  `).all();
  res.json({ summary });
});

router.post('/commissions/process-week', (req, res) => {
  const pending = db.prepare(`
    SELECT trader_id, week_start, week_end, COUNT(*) as count, SUM(amount) as total
    FROM commissions WHERE status = 'pending'
    GROUP BY trader_id, week_start, week_end
  `).all();

  const processed = db.transaction(() => {
    let count = 0;
    for (const row of pending) {
      db.prepare(`
        INSERT INTO weekly_payouts (trader_id,amount,week_start,week_end,commission_count,status,processed_at)
        VALUES (?,?,?,?,?,'pending',CURRENT_TIMESTAMP)
      `).run(row.trader_id, row.total, row.week_start, row.week_end, row.count);
      db.prepare(`UPDATE commissions SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE trader_id=? AND week_start=? AND week_end=? AND status='pending'`).run(row.trader_id, row.week_start, row.week_end);
      count++;
    }
    return count;
  })();

  res.json({ success: true, payoutsCreated: processed });
});

router.get('/commissions/payouts', (req, res) => {
  const { status } = req.query;
  let sql = `SELECT wp.*, u.name as dealer_name, u.tier as dealer_tier FROM weekly_payouts wp JOIN users u ON wp.trader_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND wp.status = ?`; params.push(status); }
  sql += ` ORDER BY wp.created_at DESC`;
  res.json({ payouts: db.prepare(sql).all(...params) });
});

router.put('/commissions/payouts/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['pending','processed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE weekly_payouts SET status=?, processed_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, req.params.id);
  res.json({ success: true });
});

/* ── Withdrawal Requests ──────────────────────────────────────────────── */
router.get('/withdrawals', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT wr.*, u.name as trader_name, u.tier as trader_tier
    FROM withdrawal_requests wr JOIN users u ON wr.trader_id = u.id
    WHERE 1=1
  `, params = [];
  if (status) { sql += ` AND wr.status = ?`; params.push(status); }
  sql += ` ORDER BY wr.requested_at DESC`;
  res.json({ withdrawals: db.prepare(sql).all(...params) });
});

router.put('/withdrawals/:id', (req, res) => {
  const { status, admin_notes } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });
  db.prepare(`
    UPDATE withdrawal_requests SET status=?, admin_notes=?, processed_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(status, admin_notes || null, req.params.id);
  res.json({ success: true });
});

/* ── Delivery Eligible Dealers ────────────────────────────────────────── */
router.get('/delivery-dealers', (req, res) => {
  const { pincode } = req.query;
  let sql = `SELECT id, name, phone, tier, pincode, will_deliver, delivery_enabled, referral_code FROM users WHERE role='trader' AND delivery_enabled=1 AND will_deliver=1`, params = [];
  if (pincode) { sql += ` AND pincode = ?`; params.push(pincode); }
  sql += ` ORDER BY tier ASC, name ASC`;
  res.json({ dealers: db.prepare(sql).all(...params) });
});

/* ── Consumers ────────────────────────────────────────────────────────── */
router.get('/consumers', (req, res) => {
  const { search, has_referral } = req.query;
  let sql = `
    SELECT c.*, u.name as dealer_name, u.tier as dealer_tier, u.phone as dealer_phone,
           u.referral_code as dealer_code,
           (SELECT COUNT(*) FROM consumer_orders WHERE consumer_id = c.id) as order_count,
           (SELECT COALESCE(SUM(total_amount),0) FROM consumer_orders WHERE consumer_id = c.id) as total_spent
    FROM consumers c
    LEFT JOIN users u ON c.linked_dealer_id = u.id
    WHERE 1=1
  `, params = [];
  if (search)       { sql += ` AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (has_referral === 'yes') { sql += ` AND c.linked_dealer_id IS NOT NULL`; }
  if (has_referral === 'no')  { sql += ` AND c.linked_dealer_id IS NULL`; }
  sql += ` ORDER BY c.created_at DESC`;
  const consumers = db.prepare(sql).all(...params);
  consumers.forEach(c => delete c.password);
  res.json({ consumers });
});

/* ── Platform Settings ────────────────────────────────────────────────── */
router.get('/settings', (_req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ settings });
});

router.put('/settings', (req, res) => {
  const { referral_discount_percent } = req.body;
  if (referral_discount_percent !== undefined) {
    const val = parseFloat(referral_discount_percent);
    if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ error: 'Discount must be 0–100' });
    db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES ('referral_discount_percent',?,CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(String(val));
  }
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json({ settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
});

/* ── Admin Consumer Orders (direct orders) stats ─────────────────────── */
router.get('/direct-orders-count', (_req, res) => {
  const count = db.prepare(`SELECT COUNT(*) as c FROM consumer_orders WHERE is_direct=1`).get().c;
  const pending = db.prepare(`SELECT COUNT(*) as c FROM consumer_orders WHERE is_direct=1 AND status='pending'`).get().c;
  res.json({ count, pending });
});

/* ═══════════════════════════════════════════════════════════════════════
 * INVENTORY MANAGEMENT
 * ═══════════════════════════════════════════════════════════════════════ */

/* ── Warehouse Inventory (products.stock) ────────────────────────────── */
router.get('/inventory/warehouse', (_req, res) => {
  try {
    res.json({ products: getWarehouseInventory() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── All Dealers' Inventory Overview ─────────────────────────────────── */
router.get('/inventory/overview', (_req, res) => {
  try {
    const overview = getInventoryOverview();
    const alerts   = getAllLowStockAlerts();
    res.json({ inventory: overview, alerts, alert_count: alerts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Single Dealer's Inventory ───────────────────────────────────────── */
router.get('/inventory/dealer/:id', (req, res) => {
  const dealer = db.prepare(`SELECT id, name, tier, phone, address, pincode FROM users WHERE id = ? AND role = 'trader'`).get(req.params.id);
  if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
  try {
    res.json({ dealer, inventory: getDealerInventory(dealer.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Low Stock Alerts ────────────────────────────────────────────────── */
router.get('/inventory/alerts', (_req, res) => {
  try {
    const alerts = getAllLowStockAlerts();
    res.json({ alerts, count: alerts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Distribute Stock to Multiple Dealers ────────────────────────────── */
router.post('/inventory/distribute', [
  body('product_id').isInt({ min: 1 }).withMessage('product_id required'),
  body('allocations').isArray({ min: 1 }).withMessage('At least one allocation required'),
  body('allocations.*.dealer_id').isInt({ min: 1 }),
  body('allocations.*.quantity').isInt({ min: 1 }),
  body('notes').optional().trim(),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { product_id, allocations, notes } = req.body;
  const totalRequested = allocations.reduce((s, a) => s + a.quantity, 0);

  try {
    const result = db.transaction(() => {
      const product = db.prepare(`SELECT id, name, stock FROM products WHERE id = ? AND status = 'active'`).get(product_id);
      if (!product) throw new Error('Product not found');
      if (product.stock < totalRequested) {
        throw new Error(`Insufficient warehouse stock (available: ${product.stock}, requested: ${totalRequested})`);
      }

      const distributed = [];
      for (const { dealer_id, quantity } of allocations) {
        const dealer = db.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'trader'`).get(dealer_id);
        if (!dealer) throw new Error(`Dealer #${dealer_id} not found`);

        // Deduct from warehouse
        db.prepare(`UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(quantity, product_id);

        // Add to dealer inventory (upsert)
        db.prepare(`
          INSERT INTO dealer_inventory (dealer_id, product_id, quantity, last_restocked_at, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(dealer_id, product_id)
          DO UPDATE SET quantity = quantity + ?, last_restocked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        `).run(dealer_id, product_id, quantity, quantity);

        // Create distribution record
        db.prepare(`
          INSERT INTO distributions (product_id, dealer_id, allocated_qty, notes)
          VALUES (?, ?, ?, ?)
        `).run(product_id, dealer_id, quantity, notes || null);

        // Log transaction
        db.prepare(`
          INSERT INTO inventory_transactions (dealer_id, product_id, quantity, type, notes)
          VALUES (?, ?, ?, 'restock', ?)
        `).run(dealer_id, product_id, quantity, notes || `Distributed by admin`);

        distributed.push({ dealer_id, dealer_name: dealer.name, quantity });
      }

      return { success: true, distributed, product_name: product.name, total: totalRequested };
    })();

    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ── Distribution History ─────────────────────────────────────────────── */
router.get('/inventory/distributions', (req, res) => {
  const { product_id, dealer_id } = req.query;
  let sql = `
    SELECT d.*, p.name as product_name, p.sku, u.name as dealer_name, u.tier as dealer_tier
    FROM distributions d
    JOIN products p ON d.product_id = p.id
    JOIN users u ON d.dealer_id = u.id
    WHERE 1=1
  `, params = [];
  if (product_id) { sql += ` AND d.product_id = ?`; params.push(Number(product_id)); }
  if (dealer_id)  { sql += ` AND d.dealer_id = ?`;  params.push(Number(dealer_id)); }
  sql += ` ORDER BY d.created_at DESC LIMIT 200`;
  res.json({ distributions: db.prepare(sql).all(...params) });
});

/* ── Restock Dealer (Admin → Dealer) ─────────────────────────────────── */
router.post('/inventory/restock', [
  body('dealer_id').isInt({ min: 1 }).withMessage('dealer_id required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.product_id').isInt({ min: 1 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('notes').optional().trim(),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  try {
    const result = restockDealer(req.body.dealer_id, req.body.items, req.body.notes);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ── Update Low Stock Threshold ──────────────────────────────────────── */
router.put('/inventory/threshold', [
  body('dealer_id').isInt({ min: 1 }),
  body('product_id').isInt({ min: 1 }),
  body('threshold').isInt({ min: 0 }),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  try {
    updateThreshold(req.body.dealer_id, req.body.product_id, req.body.threshold);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ── Inventory Transaction Log ───────────────────────────────────────── */
router.get('/inventory/transactions', (req, res) => {
  const { dealer_id, product_id, type, limit: lim } = req.query;
  let sql = `
    SELECT it.*, p.name as product_name, p.sku, u.name as dealer_name
    FROM inventory_transactions it
    JOIN products p ON it.product_id = p.id
    JOIN users u    ON it.dealer_id = u.id
    WHERE 1=1
  `, params = [];
  if (dealer_id)  { sql += ` AND it.dealer_id = ?`;  params.push(Number(dealer_id)); }
  if (product_id) { sql += ` AND it.product_id = ?`; params.push(Number(product_id)); }
  if (type)       { sql += ` AND it.type = ?`;       params.push(type); }
  sql += ` ORDER BY it.created_at DESC LIMIT ?`;
  params.push(Number(lim) || 100);
  res.json({ transactions: db.prepare(sql).all(...params) });
});

module.exports = router;
