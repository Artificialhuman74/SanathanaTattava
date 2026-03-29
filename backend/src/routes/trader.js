const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireTrader } = require('../middleware/auth');
const { deductOrderInventory, returnOrderInventory, getDealerInventory } = require('../services/inventoryService');
const { emitOrderUpdate } = require('../websocket/socketServer');

const router = express.Router();
router.use(authenticate, requireTrader);

/* ── Profile ──────────────────────────────────────────────────────────── */
router.get('/profile', (req, res) => {
  const user = { ...req.user };
  if (user.referred_by_id) {
    user.referrer = db.prepare(`SELECT id,name,email,phone,referral_code FROM users WHERE id=?`).get(user.referred_by_id);
  }
  res.json({ user });
});

/* ── Products (catalogue) ─────────────────────────────────────────────── */
router.get('/products', (req, res) => {
  const { search, category } = req.query;
  let sql = `SELECT * FROM products WHERE status='active'`, params = [];
  if (search)   { sql += ` AND (name LIKE ? OR description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  sql += ` ORDER BY category, name`;
  const products   = db.prepare(sql).all(...params);
  const categories = db.prepare(`SELECT DISTINCT category FROM products WHERE status='active' ORDER BY category`).all().map(r => r.category);
  res.json({ products, categories });
});

/* ── Sub Dealers (Tier 1 only) ────────────────────────────────────────── */
router.get('/sub-dealers', (req, res) => {
  if (req.user.tier !== 1) return res.status(403).json({ error: 'Only Tier 1 dealers can view sub-dealers' });
  const subs = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.pincode, u.address, u.referral_code,
           u.commission_rate, u.will_deliver, u.delivery_enabled, u.status, u.created_at,
           (SELECT COUNT(*) FROM consumer_orders co WHERE co.linked_dealer_id = u.id) as consumer_order_count,
           (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE trader_id=u.id AND status='paid') as total_earned,
           (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE trader_id=u.id AND status='pending') as pending_commission
    FROM users u WHERE u.referred_by_id = ? AND u.role='trader'
    ORDER BY u.created_at ASC
  `).all(req.user.id);
  res.json({ subDealers: subs });
});

router.put('/sub-dealers/:id/commission-rate', (req, res) => {
  if (req.user.tier !== 1) return res.status(403).json({ error: 'Tier 1 only' });
  const { commission_rate } = req.body;
  if (commission_rate === undefined || isNaN(commission_rate) || commission_rate < 0 || commission_rate > 50)
    return res.status(400).json({ error: 'commission_rate must be 0–50' });
  const sub = db.prepare(`SELECT id FROM users WHERE id=? AND referred_by_id=?`).get(req.params.id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Sub-dealer not found under your account' });
  db.prepare(`UPDATE users SET commission_rate=? WHERE id=?`).run(Number(commission_rate), req.params.id);
  res.json({ success: true });
});

router.put('/sub-dealers/:id/delivery', (req, res) => {
  if (req.user.tier !== 1) return res.status(403).json({ error: 'Tier 1 only' });
  const { delivery_enabled } = req.body;
  const sub = db.prepare(`SELECT * FROM users WHERE id=? AND referred_by_id=?`).get(req.params.id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Sub-dealer not found under your account' });
  if (!sub.will_deliver && delivery_enabled) return res.status(400).json({ error: 'This sub-dealer opted out of delivery at registration' });
  db.prepare(`UPDATE users SET delivery_enabled=? WHERE id=?`).run(delivery_enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});

/* ── B2B Orders ───────────────────────────────────────────────────────── */
router.get('/orders', (req, res) => {
  const orders = db.prepare(`SELECT * FROM orders WHERE trader_id=? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ orders });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND trader_id=?`).get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare(`SELECT oi.*, p.name as product_name, p.sku, p.image_url, p.unit, p.category FROM order_items oi JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?`).all(order.id);
  res.json({ order, items });
});

router.post('/orders', [
  body('items').isArray({ min: 1 }),
  body('items.*.product_id').isInt({ min: 1 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('notes').optional().trim(),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { items, notes } = req.body;
  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = db.prepare(`SELECT * FROM products WHERE id=? AND status='active'`).get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product #${item.product_id} not found` });
    if (product.stock < item.quantity) return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
    const total = product.price * item.quantity;
    subtotal += total;
    resolved.push({ ...item, price: product.price, total });
  }

  const orderNum = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const order = db.transaction(() => {
    const or = db.prepare(`INSERT INTO orders (order_number,trader_id,status,subtotal,discount,total_amount,notes) VALUES (?,?,'pending',?,0,?,?)`).run(orderNum, req.user.id, subtotal, subtotal, notes||null);
    const ii = db.prepare(`INSERT INTO order_items (order_id,product_id,quantity,price,total) VALUES (?,?,?,?,?)`);
    for (const it of resolved) {
      ii.run(or.lastInsertRowid, it.product_id, it.quantity, it.price, it.total);
      db.prepare(`UPDATE products SET stock=stock-? WHERE id=?`).run(it.quantity, it.product_id);
    }
    return db.prepare(`SELECT * FROM orders WHERE id=?`).get(or.lastInsertRowid);
  })();
  res.status(201).json({ order });
});

/* ── Consumer Orders (linked OR delivery-assigned to this dealer/sub-dealers) ── */
router.get('/consumer-orders', (req, res) => {
  const { status } = req.query;
  let dealerIds = [req.user.id];
  if (req.user.tier === 1) {
    const subs = db.prepare(`SELECT id FROM users WHERE referred_by_id=?`).all(req.user.id);
    dealerIds = [req.user.id, ...subs.map(s => s.id)];
  }
  const placeholders = dealerIds.map(() => '?').join(',');
  let sql = `
    SELECT co.*, c.name as consumer_name, c.phone as consumer_phone,
           u.name as dealer_name, u.tier as dealer_tier,
           d2.name as delivery_dealer_name, d2.phone as delivery_dealer_phone
    FROM consumer_orders co
    JOIN consumers c  ON co.consumer_id = c.id
    JOIN users u      ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    WHERE (co.linked_dealer_id IN (${placeholders}) OR co.delivery_dealer_id IN (${placeholders}))
  `;
  const params = [...dealerIds, ...dealerIds];
  if (status) { sql += ` AND co.status = ?`; params.push(status); }
  sql += ` ORDER BY co.created_at DESC`;
  const orders = db.prepare(sql).all(...params);

  /* Attach items with product details for each order */
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
  let dealerIds = [req.user.id];
  if (req.user.tier === 1) {
    const subs = db.prepare(`SELECT id FROM users WHERE referred_by_id=?`).all(req.user.id);
    dealerIds = [req.user.id, ...subs.map(s => s.id)];
  }
  const placeholders = dealerIds.map(() => '?').join(',');
  const order = db.prepare(`
    SELECT co.*, c.name as consumer_name, c.phone as consumer_phone,
           u.name as dealer_name, u.phone as dealer_phone, u.tier as dealer_tier,
           d2.name as delivery_dealer_name, d2.phone as delivery_dealer_phone,
           p.name as parent_dealer_name, p.phone as parent_dealer_phone
    FROM consumer_orders co
    JOIN consumers c  ON co.consumer_id = c.id
    JOIN users u      ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    LEFT JOIN users p  ON (u.tier=2 AND u.referred_by_id=p.id)
    WHERE co.id=? AND (co.linked_dealer_id IN (${placeholders}) OR co.delivery_dealer_id IN (${placeholders}))
  `).get(req.params.id, ...dealerIds, ...dealerIds);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare(`SELECT oi.*, p.name as product_name, p.sku, p.image_url, p.unit FROM consumer_order_items oi JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?`).all(order.id);
  res.json({ order, items });
});

/* ── Update order status: packed / out-for-delivery / delivered ─────── */
router.put('/consumer-orders/:id/status', [
  body('status').isIn(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'])
    .withMessage('Invalid status value'),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  const { status } = req.body;
  let dealerIds = [req.user.id];
  if (req.user.tier === 1) {
    const subs = db.prepare(`SELECT id FROM users WHERE referred_by_id=?`).all(req.user.id);
    dealerIds = [req.user.id, ...subs.map(s => s.id)];
  }
  const placeholders = dealerIds.map(() => '?').join(',');
  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id=? AND (linked_dealer_id IN (${placeholders}) OR delivery_dealer_id IN (${placeholders}))`).get(req.params.id, ...dealerIds, ...dealerIds);
  if (!order) return res.status(404).json({ error: 'Order not found under your account' });
  const FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
  const curIdx = FLOW.indexOf(order.status);
  const newIdx = FLOW.indexOf(status);
  if (status !== 'cancelled' && newIdx <= curIdx)
    return res.status(400).json({ error: `Cannot move order from "${order.status}" to "${status}"` });

  /* ── Inventory deduction when order is PACKED (processing) ────────── */
  if (status === 'processing') {
    const fulfillDealerId = order.delivery_dealer_id || order.linked_dealer_id;
    if (fulfillDealerId) {
      try {
        deductOrderInventory(order.id, fulfillDealerId);
      } catch (invErr) {
        return res.status(400).json({
          error: invErr.message,
          hint: 'Dealer may need a restock from admin before this order can be packed.',
        });
      }
    }
  }

  /* ── Return inventory when order is CANCELLED (if it was packed) ──── */
  if (status === 'cancelled' && ['processing', 'shipped'].includes(order.status)) {
    const fulfillDealerId = order.delivery_dealer_id || order.linked_dealer_id;
    if (fulfillDealerId) {
      try {
        returnOrderInventory(order.id, fulfillDealerId);
      } catch (invErr) {
        console.error('[inventory] return failed:', invErr.message);
        // Non-fatal — still cancel the order
      }
    }
  }

  db.prepare(`UPDATE consumer_orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, order.id);

  emitOrderUpdate({
    orderId: order.id, orderNumber: order.order_number,
    status, deliveryStatus: order.delivery_status,
    consumerId: order.consumer_id, linkedDealerId: order.linked_dealer_id,
    deliveryDealerId: order.delivery_dealer_id,
  });

  res.json({ success: true, status });
});

/* ── Assign delivery dealer (Tier 1) ────────────────────────────────── */
router.put('/consumer-orders/:id/assign-delivery', (req, res) => {
  if (req.user.tier !== 1) return res.status(403).json({ error: 'Tier 1 only can assign delivery' });
  const { delivery_dealer_id } = req.body;
  let dealerIds = [req.user.id];
  const subs = db.prepare(`SELECT id FROM users WHERE referred_by_id=?`).all(req.user.id);
  dealerIds = [req.user.id, ...subs.map(s => s.id)];
  const placeholders = dealerIds.map(() => '?').join(',');
  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id=? AND (linked_dealer_id IN (${placeholders}) OR delivery_dealer_id IN (${placeholders}))`).get(req.params.id, ...dealerIds, ...dealerIds);
  if (!order) return res.status(404).json({ error: 'Order not found under your network' });
  if (delivery_dealer_id) {
    const dealer = db.prepare(`SELECT * FROM users WHERE id=? AND (id=? OR referred_by_id=?) AND delivery_enabled=1`).get(delivery_dealer_id, req.user.id, req.user.id);
    if (!dealer) return res.status(400).json({ error: 'Dealer not eligible for delivery' });
  }
  db.prepare(`UPDATE consumer_orders SET delivery_dealer_id=? WHERE id=?`).run(delivery_dealer_id || null, req.params.id);
  res.json({ success: true });
});

/* Legacy endpoint kept for backward compat — same as assign-delivery */
router.put('/consumer-orders/:id/delivery', (req, res) => {
  if (req.user.tier !== 1) return res.status(403).json({ error: 'Tier 1 only can assign delivery' });
  const { delivery_dealer_id } = req.body;
  const subs = db.prepare(`SELECT id FROM users WHERE referred_by_id=?`).all(req.user.id);
  const dealerIds = [req.user.id, ...subs.map(s => s.id)];
  const placeholders = dealerIds.map(() => '?').join(',');
  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id=? AND (linked_dealer_id IN (${placeholders}) OR delivery_dealer_id IN (${placeholders}))`).get(req.params.id, ...dealerIds, ...dealerIds);
  if (!order) return res.status(404).json({ error: 'Order not found under your network' });
  if (delivery_dealer_id) {
    const dealer = db.prepare(`SELECT * FROM users WHERE id=? AND (id=? OR referred_by_id=?) AND delivery_enabled=1`).get(delivery_dealer_id, req.user.id, req.user.id);
    if (!dealer) return res.status(400).json({ error: 'Dealer not eligible for delivery' });
  }
  db.prepare(`UPDATE consumer_orders SET delivery_dealer_id=? WHERE id=?`).run(delivery_dealer_id || null, req.params.id);
  res.json({ success: true });
});

/* ── My Referral Info ─────────────────────────────────────────────────── */
router.get('/referral', (req, res) => {
  const me = req.user;
  let parentInfo = null;
  if (me.tier === 2 && me.referred_by_id) {
    parentInfo = db.prepare(`SELECT id,name,email,phone,referral_code FROM users WHERE id=?`).get(me.referred_by_id);
  }
  res.json({ referralCode: me.referral_code, tier: me.tier, parentInfo });
});

/* ── Commission Earnings ──────────────────────────────────────────────── */
router.get('/commissions', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT cm.*, co.order_number as order_number, co.total_amount as order_total
    FROM commissions cm
    LEFT JOIN consumer_orders co ON cm.consumer_order_id = co.id
    WHERE cm.trader_id = ?
  `, params = [req.user.id];
  if (status) { sql += ` AND cm.status = ?`; params.push(status); }
  sql += ` ORDER BY cm.created_at DESC`;
  const commissions = db.prepare(sql).all(...params);
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_count,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount END),0) as pending_amount,
      COALESCE(SUM(CASE WHEN status='paid'    THEN amount END),0) as paid_amount,
      COALESCE(SUM(amount),0) as total_amount
    FROM commissions WHERE trader_id=?
  `).get(req.user.id);

  const weeklyBreakdown = db.prepare(`
    SELECT week_start, week_end, COUNT(*) as count,
           SUM(amount) as amount, status,
           MAX(paid_at) as paid_at
    FROM commissions WHERE trader_id=?
    GROUP BY week_start, week_end ORDER BY week_start DESC
  `).all(req.user.id);

  const payouts = db.prepare(`
    SELECT * FROM weekly_payouts WHERE trader_id=? ORDER BY created_at DESC LIMIT 10
  `).all(req.user.id);

  res.json({ commissions, summary, weeklyBreakdown, payouts });
});

/* ── My Inventory ────────────────────────────────────────────────────── */
router.get('/inventory', (req, res) => {
  try {
    const inventory = getDealerInventory(req.user.id);
    res.json({ inventory });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── My Profile (extended with address/location/delivery info) ───────── */
router.get('/my-profile', (req, res) => {
  const user = db.prepare(`
    SELECT id, name, email, phone, address, pincode, tier, referral_code,
           will_deliver, delivery_enabled, commission_rate, referred_by_id,
           latitude, longitude, h3_index, availability_status, status, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);

  let referrer = null;
  if (user.referred_by_id) {
    referrer = db.prepare(`SELECT id, name, phone, email, referral_code FROM users WHERE id = ?`)
      .get(user.referred_by_id);
  }

  // Sub-dealers count (Tier 1)
  let subDealerCount = 0;
  if (user.tier === 1) {
    subDealerCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE referred_by_id = ?`).get(user.id).c;
  }

  // Consumer count linked to this dealer
  const consumerCount = db.prepare(`SELECT COUNT(*) as c FROM consumers WHERE linked_dealer_id = ?`).get(user.id).c;

  // Inventory summary
  const inventorySummary = db.prepare(`
    SELECT COUNT(*) as total_products,
           COALESCE(SUM(quantity), 0) as total_units,
           COUNT(CASE WHEN quantity <= low_stock_threshold THEN 1 END) as low_stock_count
    FROM dealer_inventory WHERE dealer_id = ?
  `).get(user.id);

  res.json({ user, referrer, subDealerCount, consumerCount, inventorySummary });
});

/* ── Update My Profile ────────────────────────────────────────────────── */
router.put('/my-profile', (req, res) => {
  const { name, phone, address, pincode } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined && name.trim()) { updates.push('name = ?'); params.push(name.trim()); }
  if (phone !== undefined) { updates.push('phone = ?'); params.push(phone.trim()); }
  if (address !== undefined) { updates.push('address = ?'); params.push(address.trim()); }
  if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode.trim()); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.user.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(`
    SELECT id, name, email, phone, address, pincode, tier, referral_code,
           will_deliver, delivery_enabled, commission_rate, referred_by_id,
           latitude, longitude, h3_index, availability_status, status, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);

  // Also update localStorage-compatible user object
  res.json({ success: true, user: updated });
});

module.exports = router;
