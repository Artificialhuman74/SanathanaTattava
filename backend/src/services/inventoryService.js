/**
 * Inventory Service
 *
 * Manages the two-tier inventory model:
 *   - Warehouse (products.stock)  — admin's central inventory
 *   - Dealer    (dealer_inventory) — per-dealer local stock
 *
 * Key operations:
 *   1. Restock: admin distributes warehouse → dealer
 *   2. Order deduction: dealer stock decreases when order is PACKED
 *   3. Low stock detection + admin alerting
 *   4. Inventory queries across all dealers
 */

const db = require('../database/db');

/* ── Restock: Admin → Dealer ─────────────────────────────────────────── */

/**
 * Transfer stock from warehouse to a dealer.
 *
 * @param {number} dealerId
 * @param {Array<{ product_id: number, quantity: number }>} items
 * @param {string} [notes]
 * @returns {{ success: boolean, transferred: object[] }}
 * @throws If warehouse has insufficient stock
 */
function restockDealer(dealerId, items, notes = '') {
  const dealer = db.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'trader'`).get(dealerId);
  if (!dealer) throw new Error('Dealer not found');

  return db.transaction(() => {
    const transferred = [];

    for (const item of items) {
      const { product_id, quantity } = item;
      if (!quantity || quantity <= 0) throw new Error(`Invalid quantity for product #${product_id}`);

      const product = db.prepare(`SELECT id, name, stock FROM products WHERE id = ? AND status = 'active'`).get(product_id);
      if (!product) throw new Error(`Product #${product_id} not found`);
      if (product.stock < quantity) {
        throw new Error(`Insufficient warehouse stock for "${product.name}" (available: ${product.stock}, requested: ${quantity})`);
      }

      // Deduct from warehouse
      db.prepare(`UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(quantity, product_id);

      // Add to dealer inventory (upsert)
      db.prepare(`
        INSERT INTO dealer_inventory (dealer_id, product_id, quantity, last_restocked_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(dealer_id, product_id)
        DO UPDATE SET quantity = quantity + ?, last_restocked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      `).run(dealerId, product_id, quantity, quantity);

      // Log transaction
      db.prepare(`
        INSERT INTO inventory_transactions (dealer_id, product_id, quantity, type, notes)
        VALUES (?, ?, ?, 'restock', ?)
      `).run(dealerId, product_id, quantity, notes || `Restocked by admin`);

      transferred.push({
        product_id,
        product_name: product.name,
        quantity,
        warehouse_remaining: product.stock - quantity,
      });
    }

    // Check for low stock alerts after restock
    checkLowStockAlerts(dealerId);

    return { success: true, transferred };
  })();
}

/* ── Order Deduction: Decrease dealer stock on PACKED ────────────────── */

/**
 * Deduct order items from inventory.
 * Called when order status changes to 'processing' (packed).
 *
 * If the fulfilling user is an admin (e.g. after a delivery takeover), stock
 * is pulled from the warehouse (products.stock) instead of dealer_inventory —
 * the original dealer's stock must not be touched.
 *
 * @param {number} orderId
 * @param {number} fulfillerId  The user fulfilling delivery (dealer OR admin)
 * @returns {{ success: boolean, deducted: object[] }}
 * @throws If stock is insufficient for any item
 */
function deductOrderInventory(orderId, fulfillerId) {
  const items = db.prepare(`
    SELECT oi.product_id, oi.quantity, p.name as product_name
    FROM consumer_order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId);

  if (items.length === 0) throw new Error('No items found for this order');

  const fulfiller = db.prepare(`SELECT role FROM users WHERE id = ?`).get(fulfillerId);
  const isAdmin = fulfiller && fulfiller.role === 'admin';

  return db.transaction(() => {
    // Idempotency: skip if already deducted for this order
    const order = db.prepare(`SELECT inventory_deducted FROM consumer_orders WHERE id = ?`).get(orderId);
    if (!order) throw new Error('Order not found');
    if (order.inventory_deducted) {
      return { success: true, deducted: [], already_deducted: true };
    }

    const deducted = [];

    for (const item of items) {
      if (isAdmin) {
        // Admin-fulfilled (e.g. takeover): pull from warehouse, NOT dealer stock
        const product = db.prepare(`SELECT stock, name FROM products WHERE id = ?`).get(item.product_id);
        const currentQty = product ? product.stock : 0;
        if (currentQty < item.quantity) {
          throw new Error(
            `Insufficient warehouse stock for "${item.product_name}" ` +
            `(warehouse has ${currentQty}, order needs ${item.quantity})`
          );
        }
        db.prepare(`
          UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(item.quantity, item.product_id);

        deducted.push({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity_deducted: item.quantity,
          remaining: currentQty - item.quantity,
          source: 'warehouse',
        });
      } else {
        // Check dealer has enough stock
        const inv = db.prepare(`
          SELECT quantity FROM dealer_inventory
          WHERE dealer_id = ? AND product_id = ?
        `).get(fulfillerId, item.product_id);

        const currentQty = inv ? inv.quantity : 0;
        if (currentQty < item.quantity) {
          throw new Error(
            `Insufficient dealer stock for "${item.product_name}" ` +
            `(dealer has ${currentQty}, order needs ${item.quantity})`
          );
        }

        // Deduct
        db.prepare(`
          UPDATE dealer_inventory
          SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
          WHERE dealer_id = ? AND product_id = ?
        `).run(item.quantity, fulfillerId, item.product_id);

        // Log transaction
        db.prepare(`
          INSERT INTO inventory_transactions (dealer_id, product_id, quantity, type, reference_id, notes)
          VALUES (?, ?, ?, 'order_deduct', ?, ?)
        `).run(fulfillerId, item.product_id, -item.quantity, orderId, `Order #${orderId} packed`);

        deducted.push({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity_deducted: item.quantity,
          remaining: currentQty - item.quantity,
          source: 'dealer',
        });
      }
    }

    // Mark order as deducted + record who fulfilled it (admin id when taken over)
    db.prepare(`
      UPDATE consumer_orders
      SET inventory_deducted = 1, fulfilled_by_dealer_id = ?
      WHERE id = ?
    `).run(fulfillerId, orderId);

    // Low-stock alerts only meaningful for dealer fulfilment
    if (!isAdmin) checkLowStockAlerts(fulfillerId);

    return { success: true, deducted };
  })();
}

/**
 * Return inventory when an order is cancelled / refunded / payment failed.
 * Idempotent: safe to call multiple times — only restores once.
 * Reads the dealer from the order row (set when inventory was originally deducted).
 *
 * @param {number} orderId
 * @returns {{ success: boolean, restored: boolean, reason?: string }}
 */
function returnOrderInventory(orderId) {
  return db.transaction(() => {
    const order = db.prepare(`
      SELECT id, inventory_deducted, inventory_restored, fulfilled_by_dealer_id
      FROM consumer_orders WHERE id = ?
    `).get(orderId);

    if (!order) return { success: false, restored: false, reason: 'order_not_found' };
    if (!order.inventory_deducted) return { success: true, restored: false, reason: 'never_deducted' };
    if (order.inventory_restored)  return { success: true, restored: false, reason: 'already_restored' };

    const dealerId = order.fulfilled_by_dealer_id;
    if (!dealerId) return { success: false, restored: false, reason: 'no_dealer_recorded' };

    const fulfiller = db.prepare(`SELECT role FROM users WHERE id = ?`).get(dealerId);
    const isAdmin = fulfiller && fulfiller.role === 'admin';

    const items = db.prepare(`
      SELECT oi.product_id, oi.quantity
      FROM consumer_order_items oi
      WHERE oi.order_id = ?
    `).all(orderId);

    for (const item of items) {
      if (isAdmin) {
        // Admin-fulfilled: warehouse was debited at order creation, restore it there
        db.prepare(`UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(item.quantity, item.product_id);
      } else {
        db.prepare(`
          INSERT INTO dealer_inventory (dealer_id, product_id, quantity, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(dealer_id, product_id)
          DO UPDATE SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
        `).run(dealerId, item.product_id, item.quantity, item.quantity);

        db.prepare(`
          INSERT INTO inventory_transactions (dealer_id, product_id, quantity, type, reference_id, notes)
          VALUES (?, ?, ?, 'return', ?, ?)
        `).run(dealerId, item.product_id, item.quantity, orderId, `Order #${orderId} cancelled — stock returned`);
      }
    }

    db.prepare(`UPDATE consumer_orders SET inventory_restored = 1 WHERE id = ?`).run(orderId);

    return { success: true, restored: true, fulfilled_by: isAdmin ? 'admin' : 'dealer' };
  })();
}

/* ── Low Stock Alerts ────────────────────────────────────────────────── */

/**
 * Check all items in a dealer's inventory against thresholds.
 * Creates admin notifications for any low-stock items.
 */
function checkLowStockAlerts(dealerId) {
  const lowItems = db.prepare(`
    SELECT di.*, p.name as product_name, p.unit, u.name as dealer_name
    FROM dealer_inventory di
    JOIN products p ON di.product_id = p.id
    JOIN users u    ON di.dealer_id = u.id
    WHERE di.dealer_id = ? AND di.quantity <= di.low_stock_threshold AND di.quantity >= 0
  `).all(dealerId);

  if (lowItems.length === 0) return;

  // Use the notification service if available
  try {
    const { notifyAdminLowStock } = require('./notificationService');
    for (const item of lowItems) {
      notifyAdminLowStock(item);
    }
  } catch {
    // Notification service not loaded yet — just log
    for (const item of lowItems) {
      console.log(`[LOW STOCK] Dealer "${item.dealer_name}" — ${item.product_name}: ${item.quantity} units (threshold: ${item.low_stock_threshold})`);
    }
  }
}

/**
 * Get all low-stock situations across all dealers.
 */
function getAllLowStockAlerts() {
  return db.prepare(`
    SELECT di.dealer_id, di.product_id, di.quantity, di.low_stock_threshold,
           p.name as product_name, p.sku, p.image_url,
           u.name as dealer_name, u.phone as dealer_phone, u.tier as dealer_tier,
           CASE WHEN di.quantity <= 0 THEN 'OUT_OF_STOCK'
                WHEN di.quantity <= di.low_stock_threshold THEN 'LOW_STOCK'
                ELSE 'OK' END as stock_status
    FROM dealer_inventory di
    JOIN products p ON di.product_id = p.id
    JOIN users u    ON di.dealer_id = u.id
    WHERE di.quantity <= di.low_stock_threshold
    ORDER BY di.quantity ASC, u.name ASC
  `).all();
}

/* ── Query: Dealer Inventory ─────────────────────────────────────────── */

/**
 * Get all inventory for a specific dealer.
 */
function getDealerInventory(dealerId) {
  return db.prepare(`
    SELECT di.*, p.name as product_name, p.sku, p.image_url, p.price, p.unit, p.category,
           CASE WHEN di.quantity <= 0 THEN 'OUT_OF_STOCK'
                WHEN di.quantity <= di.low_stock_threshold THEN 'LOW_STOCK'
                ELSE 'OK' END as stock_status
    FROM dealer_inventory di
    JOIN products p ON di.product_id = p.id
    WHERE di.dealer_id = ?
    ORDER BY stock_status DESC, p.name ASC
  `).all(dealerId);
}

/**
 * Get aggregated inventory view across all dealers (for admin dashboard).
 */
function getInventoryOverview() {
  return db.prepare(`
    SELECT di.dealer_id, di.product_id, di.quantity, di.low_stock_threshold,
           p.name as product_name, p.sku, p.stock as warehouse_stock, p.image_url,
           u.name as dealer_name, u.tier as dealer_tier, u.phone as dealer_phone,
           CASE WHEN di.quantity <= 0 THEN 'OUT_OF_STOCK'
                WHEN di.quantity <= di.low_stock_threshold THEN 'LOW_STOCK'
                ELSE 'OK' END as stock_status
    FROM dealer_inventory di
    JOIN products p ON di.product_id = p.id
    JOIN users u    ON di.dealer_id = u.id
    WHERE u.status = 'active'
    ORDER BY u.name ASC, p.name ASC
  `).all();
}

/**
 * Get warehouse (admin) inventory summary.
 */
function getWarehouseInventory() {
  return db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(di.quantity) FROM dealer_inventory di WHERE di.product_id = p.id), 0) as total_dealer_stock,
      p.stock as warehouse_stock
    FROM products p
    WHERE p.status = 'active'
    ORDER BY p.category, p.name
  `).all();
}

/**
 * Update low stock threshold for a dealer-product combo.
 */
function updateThreshold(dealerId, productId, threshold) {
  db.prepare(`
    UPDATE dealer_inventory
    SET low_stock_threshold = ?, updated_at = CURRENT_TIMESTAMP
    WHERE dealer_id = ? AND product_id = ?
  `).run(threshold, dealerId, productId);
}

/* ── Exports ─────────────────────────────────────────────────────────── */

module.exports = {
  restockDealer,
  deductOrderInventory,
  returnOrderInventory,
  checkLowStockAlerts,
  getAllLowStockAlerts,
  getDealerInventory,
  getInventoryOverview,
  getWarehouseInventory,
  updateThreshold,
};
