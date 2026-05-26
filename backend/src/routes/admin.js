const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { emitOrderUpdate, emitContainerHoldingUpdate } = require('../websocket/socketServer');
const {
  restockDealer,
  getInventoryOverview,
  getWarehouseInventory,
  getDealerInventory,
  getAllLowStockAlerts,
  updateThreshold,
  returnOrderInventory,
} = require('../services/inventoryService');

const router = express.Router();
router.use(authenticate, requireAdmin);

/* Allowed container types for the Containers feature. NULL means
 * "no container" — valid for products that don't carry a deposit. */
const ALLOWED_CONTAINER_TYPES = ['2.8L', '5L'];
const INVALID_CT = Symbol('invalid-container-type');
function normaliseContainerType(v) {
  if (v === undefined || v === null || v === '') return null;
  return ALLOWED_CONTAINER_TYPES.includes(v) ? v : INVALID_CT;
}

/* ── Admin profile ───────────────────────────────────────────────────── */
router.get('/me', (req, res) => {
  const admin = db.prepare('SELECT id,name,email,phone FROM users WHERE id=?').get(req.user.id);
  res.json({ admin });
});

router.put('/me', (req, res) => {
  const { name, phone } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?')
    .run(String(name).trim(), phone ? String(phone).trim() : null, req.user.id);
  res.json({ success: true });
});

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
  const { name, description, category, sku, price, cost_price, container_cost, container_type, stock, min_stock, image_url, image_urls, unit, hsn_code } = req.body;
  const ct = normaliseContainerType(container_type);
  if (ct === INVALID_CT) return res.status(400).json({ error: `container_type must be one of: ${ALLOWED_CONTAINER_TYPES.join(', ')}` });
  if (db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku)) return res.status(409).json({ error: 'SKU already exists' });
  const result = db.prepare(`
    INSERT INTO products (name,description,category,sku,price,cost_price,container_cost,container_type,stock,min_stock,image_url,image_urls,unit,hsn_code,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active')
  `).run(name, description||null, category, sku, price, cost_price||null, container_cost||0, ct, stock||0, min_stock||10, image_url||null, image_urls||null, unit||'piece', hsn_code||null);
  res.status(201).json({ product: db.prepare(`SELECT * FROM products WHERE id = ?`).get(result.lastInsertRowid) });
});

router.put('/products/:id', (req, res) => {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const { name, description, category, sku, price, cost_price, container_cost, container_type, stock, min_stock, image_url, image_urls, unit, status, hsn_code } = req.body;
  if (sku && sku !== product.sku && db.prepare(`SELECT id FROM products WHERE sku = ? AND id != ?`).get(sku, product.id))
    return res.status(409).json({ error: 'SKU already in use' });
  let ct = product.container_type;
  if (container_type !== undefined) {
    ct = normaliseContainerType(container_type);
    if (ct === INVALID_CT) return res.status(400).json({ error: `container_type must be one of: ${ALLOWED_CONTAINER_TYPES.join(', ')}` });
  }
  db.prepare(`
    UPDATE products SET name=?,description=?,category=?,sku=?,price=?,cost_price=?,container_cost=?,container_type=?,stock=?,min_stock=?,image_url=?,image_urls=?,unit=?,hsn_code=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(name??product.name, description??product.description, category??product.category, sku??product.sku,
         price??product.price, cost_price??product.cost_price, container_cost??product.container_cost??0, ct,
         stock??product.stock, min_stock??product.min_stock,
         image_url??product.image_url, image_urls??product.image_urls, unit??product.unit, hsn_code??product.hsn_code, status??product.status, product.id);
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
    WHERE u.role = 'trader' AND u.status != 'deleted'
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

router.put('/traders/:id/pan-verify', (req, res) => {
  const trader = db.prepare(`SELECT id, pan FROM users WHERE id = ? AND role = 'trader'`).get(req.params.id);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  if (!trader.pan) return res.status(400).json({ error: 'Trader has not submitted their PAN' });
  const { verified } = req.body;
  // Reset pan_celebrated so the trader sees confetti the next time they open
  // their dashboard after being verified.
  db.prepare(`UPDATE users SET pan_verified = ?, pan_celebrated = 0 WHERE id = ?`)
    .run(verified ? 1 : 0, req.params.id);
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

router.delete('/traders/:id', (req, res) => {
  const trader = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'trader'`).get(req.params.id);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  // Soft-delete: mark as 'deleted' so all FK-linked history (orders, commissions, etc.) stays intact.
  // Orphan any sub-dealers so they no longer appear under this trader.
  db.prepare(`UPDATE users SET referred_by_id = NULL WHERE referred_by_id = ?`).run(req.params.id);
  db.prepare(`UPDATE users SET status = 'deleted' WHERE id = ?`).run(req.params.id);
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
           c.address as consumer_address, c.pincode as consumer_pincode,
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

  if (status === 'cancelled') {
    try { returnOrderInventory(order.id); }
    catch (invErr) { console.error('[admin cancel] inventory restore failed:', invErr.message); }
  }

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

/* ── Razorpay Route Payouts — trader bank/linked-account overview ─────── */
/* Admin payouts cover ONLY tier-1 traders. Sub-dealer (tier-2) direct
 * commissions are settled offline by the parent tier-1 dealer. */
router.get('/payouts/traders', (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.tier, u.status,
           u.bank_account_name, u.bank_account_number, u.bank_ifsc,
           u.razorpay_linked_account_id, u.razorpay_account_status,
           COALESCE(SUM(CASE WHEN cm.status='pending' THEN cm.amount END), 0) AS pending_amount,
           COALESCE(SUM(CASE WHEN cm.status='transferring' THEN cm.amount END), 0) AS transferring_amount,
           COALESCE(SUM(CASE WHEN cm.status='transferred' THEN cm.amount END), 0) AS transferred_amount,
           COUNT(CASE WHEN cm.status='pending' THEN 1 END) AS pending_count
    FROM users u
    LEFT JOIN commissions cm ON cm.trader_id = u.id
    WHERE u.role = 'trader' AND u.tier = 1
    GROUP BY u.id
    ORDER BY pending_amount DESC, u.name ASC
  `).all();
  res.json({ traders: rows });
});

router.get('/payouts/pending-commissions', (req, res) => {
  const { trader_id } = req.query;
  let sql = `
    SELECT cm.id, cm.trader_id, cm.amount, cm.rate, cm.type, cm.status,
           cm.razorpay_transfer_id, cm.created_at,
           u.name AS trader_name, u.razorpay_linked_account_id, u.razorpay_account_status,
           co.order_number, co.razorpay_payment_id, co.total_amount AS order_amount
    FROM commissions cm
    JOIN users u ON u.id = cm.trader_id
    LEFT JOIN consumer_orders co ON co.id = cm.consumer_order_id
    WHERE u.tier = 1
      AND cm.status IN ('pending', 'transferring', 'transfer_failed', 'transferred')
  `;
  const params = [];
  if (trader_id) { sql += ` AND cm.trader_id = ?`; params.push(Number(trader_id)); }
  sql += ` ORDER BY cm.created_at DESC LIMIT 500`;
  res.json({ commissions: db.prepare(sql).all(...params) });
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
           (SELECT COALESCE(SUM(total_amount),0) FROM consumer_orders WHERE consumer_id = c.id AND payment_status = 'paid') as total_spent
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

/* ═══════════════════════════════════════════════════════════════════════
 * Container Deposit lifecycle
 * Refund: deposit returned to customer (no GST impact)
 * Forfeit: container not returned/damaged → deposit becomes taxable supply,
 *          a supplementary tax invoice is issued (CGST Act §15)
 * ═══════════════════════════════════════════════════════════════════════ */
const { refundDeposit, forfeitDeposit, DEFAULT_FORFEIT_TAX_RATE } = require('../services/containerDepositService');

router.get('/container-deposits', (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.invoice_number, i.order_id, i.customer_name, i.customer_email,
           i.customer_phone, i.customer_address, i.container_deposit,
           i.container_deposit_status, i.container_deposit_resolved_at,
           i.container_deposit_notes, i.created_at,
           co.order_number, co.status AS order_status,
           sup.id AS supplementary_invoice_id, sup.invoice_number AS supplementary_invoice_number,
           u.name AS resolved_by_name
      FROM invoices i
      JOIN consumer_orders co ON co.id = i.order_id
      LEFT JOIN invoices sup ON sup.parent_invoice_id = i.id AND sup.invoice_type='supplementary'
      LEFT JOIN users u ON u.id = i.container_deposit_resolved_by
     WHERE i.invoice_type='tax' AND i.container_deposit > 0
     ORDER BY
       CASE i.container_deposit_status WHEN 'held' THEN 0 WHEN 'refunded' THEN 1 ELSE 2 END,
       i.created_at DESC
  `).all();
  res.json({ deposits: rows, defaultForfeitTaxRate: DEFAULT_FORFEIT_TAX_RATE });
});

router.post('/container-deposits/:invoiceId/refund', (req, res) => {
  try {
    const updated = refundDeposit(Number(req.params.invoiceId), {
      adminId: req.user.id,
      notes:   req.body?.notes || null,
    });
    res.json({ success: true, invoice: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/container-deposits/:invoiceId/forfeit', async (req, res) => {
  try {
    const result = await forfeitDeposit(Number(req.params.invoiceId), {
      adminId: req.user.id,
      taxRate: req.body?.tax_rate,
      notes:   req.body?.notes || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ═════════════════════════════════════════════════════════════════════
 * Phase 7 — Manual refund payout queue
 *
 * Lists every refunded+manual_bank holding awaiting a bank transfer. Admin
 * wires the deposit out-of-band (UPI / NEFT) and stamps the UTR back here
 * for audit. Once stamped, the holding falls off this queue.
 * ═════════════════════════════════════════════════════════════════════ */
const {
  getPendingManualRefunds,
  settleManualRefund,
} = require('../services/storeCreditService');

router.get('/manual-refunds', (req, res) => {
  try {
    res.json({ refunds: getPendingManualRefunds() });
  } catch (err) {
    console.error('GET /admin/manual-refunds error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/manual-refunds/:holdingId/settle',
  body('utr').isString().trim().isLength({ min: 4 }),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const result = settleManualRefund({
        holdingId: Number(req.params.holdingId),
        utr: req.body.utr,
        notes: req.body.notes,
        paidByUserId: req.user.id,
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'NOT_FOUND')        return res.status(404).json({ error: err.message });
      if (err.code === 'INVALID_UTR')      return res.status(400).json({ error: err.message });
      if (err.code === 'INVALID_STATUS')   return res.status(400).json({ error: err.message });
      if (err.code === 'ALREADY_SETTLED')  return res.status(409).json({ error: err.message });
      console.error('POST /admin/manual-refunds/:id/settle error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/* ── Phase 8: admin holdings dashboard + override ────────────────────── */
const {
  listAllHoldings,
  getHoldingDetail,
  adminOverrideHolding,
  adminVerifyRefundProof,
  adminReimburseDriver,
  getDamageDisputes,
  VALID_STATUSES,
  VALID_DESTINATIONS,
} = require('../services/containerHoldingsService');

router.get('/holdings', (req, res) => {
  try {
    const { status, consumer_id, container_type, search, limit, offset } = req.query;
    const statusArr = status ? String(status).split(',').filter(Boolean) : undefined;
    const out = listAllHoldings({
      status: statusArr && statusArr.length === 1 ? statusArr[0] : statusArr,
      consumerId:    consumer_id ? parseInt(consumer_id, 10) : undefined,
      containerType: container_type || undefined,
      search:        search || undefined,
      limit:  limit  ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
      offset: offset ? parseInt(offset, 10) || 0 : 0,
    });
    res.json(out);
  } catch (err) {
    console.error('GET /admin/holdings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/holdings/:id', (req, res) => {
  try {
    const detail = getHoldingDetail(parseInt(req.params.id, 10));
    if (!detail) return res.status(404).json({ error: 'Holding not found' });
    res.json(detail);
  } catch (err) {
    console.error('GET /admin/holdings/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/holdings/:id/override',
  body('new_status').isIn(VALID_STATUSES),
  body('new_destination').optional({ nullable: true }).isIn(VALID_DESTINATIONS),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 500 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const result = adminOverrideHolding({
        holdingId:      parseInt(req.params.id, 10),
        actorUserId:    req.user.id,
        newStatus:      req.body.new_status,
        newDestination: req.body.new_destination || null,
        notes:          req.body.notes || null,
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'NOT_FOUND')           return res.status(404).json({ error: err.message });
      if (err.code === 'INVALID_STATUS')      return res.status(400).json({ error: err.message });
      if (err.code === 'INVALID_DESTINATION') return res.status(400).json({ error: err.message });
      if (err.code === 'MISSING_DESTINATION') return res.status(400).json({ error: err.message });
      console.error('POST /admin/holdings/:id/override error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/* ═════════════════════════════════════════════════════════════════════
 * Phase 9 — UPI refund verification + driver reimbursement
 *
 * Lifecycle (when delivery agent picks up a container and the consumer
 * elected an immediate UPI refund):
 *   1. Driver pays via their own UPI, uploads screenshot
 *      → container_holdings.refund_proof_url set, refund_paid_via='manual_upi'
 *   2. Admin opens Container Deposits, verifies the proof matches the
 *      deposit amount → admin_verified_at stamped (event: admin_verified_upi_proof)
 *   3. Admin reimburses the driver out-of-band, then clicks "Reimburse"
 *      → driver_reimbursed_at + amount stamped (event: driver_reimbursed)
 *
 * Damage path: driver marks forfeited, uploads damage photo, holding gets
 * dispute_deadline = now + 48h. Consumer can dispute via their UI until
 * then; admin resolves disputes through /holdings/:id/resolve-dispute.
 * ═════════════════════════════════════════════════════════════════════ */

router.get('/container-deposits/pending-verification', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT h.id, h.consumer_id, h.deposit_amount, h.container_type,
             h.refund_proof_url, h.refund_paid_via, h.refund_destination,
             h.driver_user_id, h.requested_at, h.resolved_at, h.notes,
             c.name AS consumer_name, c.phone AS consumer_phone,
             u.name AS driver_name, u.phone AS driver_phone
        FROM container_holdings h
        JOIN consumers c ON c.id = h.consumer_id
        LEFT JOIN users u ON u.id = h.driver_user_id
       WHERE h.refund_paid_via='manual_upi'
         AND h.refund_proof_url IS NOT NULL
         AND h.admin_verified_at IS NULL
       ORDER BY h.resolved_at DESC, h.id DESC
    `).all();
    res.json({ pending: rows });
  } catch (err) {
    console.error('GET /admin/container-deposits/pending-verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/container-deposits/pending-reimbursement', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT h.id, h.consumer_id, h.deposit_amount, h.container_type,
             h.refund_proof_url, h.driver_user_id, h.admin_verified_at,
             h.resolved_at, h.notes,
             c.name AS consumer_name, c.phone AS consumer_phone,
             u.name AS driver_name, u.phone AS driver_phone,
             COALESCE(av.name, 'admin') AS verified_by_name
        FROM container_holdings h
        JOIN consumers c ON c.id = h.consumer_id
        LEFT JOIN users u  ON u.id  = h.driver_user_id
        LEFT JOIN users av ON av.id = h.admin_verified_by
       WHERE h.refund_paid_via='manual_upi'
         AND h.admin_verified_at IS NOT NULL
         AND h.driver_reimbursed_at IS NULL
       ORDER BY h.admin_verified_at ASC
    `).all();
    const totalOwedDriver = rows.reduce((s, r) => s + Number(r.deposit_amount || 0), 0);
    res.json({ pending: rows, totalOwedDriver });
  } catch (err) {
    console.error('GET /admin/container-deposits/pending-reimbursement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/container-deposits/holdings/:id/verify-proof',
  body('approved').isBoolean(),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 500 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = parseInt(req.params.id, 10);
      const result = adminVerifyRefundProof({
        holdingId:   id,
        adminUserId: req.user.id,
        approved:    !!req.body.approved,
        notes:       req.body.notes || null,
      });
      try {
        const ctx = db.prepare(`
          SELECT h.consumer_id, h.driver_user_id, c.linked_dealer_id
            FROM container_holdings h
            JOIN consumers c ON c.id=h.consumer_id WHERE h.id=?
        `).get(id);
        emitContainerHoldingUpdate({
          holdingId: id,
          consumerId: ctx?.consumer_id,
          linkedDealerId: ctx?.driver_user_id || ctx?.linked_dealer_id,
          event: req.body.approved ? 'proof_verified' : 'proof_rejected',
        });
      } catch (_) {}
      res.json(result);
    } catch (err) {
      if (err.code === 'NOT_FOUND')   return res.status(404).json({ error: err.message });
      if (err.code === 'WRONG_FLOW')  return res.status(400).json({ error: err.message });
      if (err.code === 'NO_PROOF')    return res.status(400).json({ error: err.message });
      console.error('POST /admin/.../verify-proof error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/container-deposits/holdings/:id/reimburse-driver',
  body('amount').optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 500 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = parseInt(req.params.id, 10);
      const result = adminReimburseDriver({
        holdingId:   id,
        adminUserId: req.user.id,
        amount:      req.body.amount,
        notes:       req.body.notes || null,
      });
      try {
        const ctx = db.prepare(`
          SELECT h.consumer_id, h.driver_user_id FROM container_holdings h WHERE h.id=?
        `).get(id);
        emitContainerHoldingUpdate({
          holdingId: id,
          consumerId: ctx?.consumer_id,
          linkedDealerId: ctx?.driver_user_id,
          event: 'driver_reimbursed',
        });
      } catch (_) {}
      res.json(result);
    } catch (err) {
      if (err.code === 'NOT_FOUND')      return res.status(404).json({ error: err.message });
      if (err.code === 'WRONG_FLOW')     return res.status(400).json({ error: err.message });
      if (err.code === 'NOT_VERIFIED')   return res.status(400).json({ error: err.message });
      if (err.code === 'INVALID_AMOUNT') return res.status(400).json({ error: err.message });
      console.error('POST /admin/.../reimburse-driver error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/* Damage disputes — list open + resolve (uphold/reverse). */
router.get('/damage-disputes', (req, res) => {
  try {
    res.json({ disputes: getDamageDisputes() });
  } catch (err) {
    console.error('GET /admin/damage-disputes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/damage-disputes/:id/resolve',
  body('resolution').isIn(['upheld', 'rejected']),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 500 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = parseInt(req.params.id, 10);
    const row = db.prepare(`
      SELECT id, consumer_id, damage_dispute_status, status
        FROM container_holdings WHERE id=?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'holding not found' });
    if (row.status !== 'forfeited') {
      return res.status(400).json({ error: 'only forfeited holdings can be resolved' });
    }
    if (row.damage_dispute_status !== 'open') {
      return res.status(409).json({ error: `dispute is ${row.damage_dispute_status || 'not open'}` });
    }
    const resolution = req.body.resolution; // 'upheld' = consumer wins, 'rejected' = forfeit stands
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE container_holdings
           SET damage_dispute_status=?,
               dispute_resolved_at=CURRENT_TIMESTAMP,
               dispute_resolved_by=?,
               notes=COALESCE(? || char(10) || COALESCE(notes,''), notes),
               updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).run(resolution, req.user.id, req.body.notes || null, id);
      db.prepare(`
        INSERT INTO container_finance_log
          (holding_id, consumer_id, event_type, amount, direction, actor_user_id)
        VALUES (?, ?, ?, 0, 'dispute', ?)
      `).run(id, row.consumer_id, `admin_dispute_${resolution}`, req.user.id);
    });
    try {
      tx();
      res.json({ ok: true, resolution });
    } catch (err) {
      console.error('POST /admin/damage-disputes/:id/resolve error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/* Finance log — append-only money trail for Phase 9 events. Drives the
 * "Container finance" tab on the admin Finance page. */
router.get('/container-finance/log', (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10)  || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const rows = db.prepare(`
      SELECT l.id, l.holding_id, l.consumer_id, l.driver_user_id,
             l.event_type, l.amount, l.direction, l.actor_user_id,
             l.reference, l.created_at,
             c.name AS consumer_name,
             u.name AS driver_name,
             a.name AS actor_name
        FROM container_finance_log l
        LEFT JOIN consumers c ON c.id = l.consumer_id
        LEFT JOIN users u     ON u.id = l.driver_user_id
        LEFT JOIN users a     ON a.id = l.actor_user_id
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ? OFFSET ?
    `).all(limit, offset);
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN event_type='driver_reimbursed' THEN amount END),0) AS driver_paid_total,
        COALESCE(SUM(CASE WHEN event_type='admin_verified_upi_proof' THEN amount END),0) AS verified_total,
        COUNT(*) AS total_events
        FROM container_finance_log
    `).get();
    res.json({ events: rows, totals });
  } catch (err) {
    console.error('GET /admin/container-finance/log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
