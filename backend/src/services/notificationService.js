/**
 * Notification Service
 *
 * Lightweight notification layer for delivery assignments.
 * Saves to DB + pushes via WebSocket in real time.
 */

const db = require('../database/db');

// Lazy-load socket emitter (avoids circular dependency at boot)
let _emitNotification = null;
function pushNotification(userType, userId, notification) {
  if (!_emitNotification) {
    try { _emitNotification = require('../websocket/socketServer').emitNotification; } catch { return; }
  }
  try { _emitNotification(userType, userId, notification); } catch { /* socket not ready yet */ }
}

/* ── Ensure table exists (safe to call multiple times) ───────────────── */

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type   TEXT    NOT NULL,               -- 'dealer' | 'consumer' | 'admin'
    user_id     INTEGER NOT NULL,               -- users.id or consumers.id
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    data        TEXT,                            -- JSON payload for client
    channel     TEXT    NOT NULL DEFAULT 'in_app', -- 'in_app' | 'push' | 'sms'
    read        INTEGER NOT NULL DEFAULT 0,     -- 0 = unread, 1 = read
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user
         ON notifications(user_type, user_id, read)`);

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Send a notification to a dealer about a new delivery assignment.
 *
 * @param {object} opts
 * @param {number} opts.dealerId
 * @param {string} opts.dealerName
 * @param {string} opts.orderNumber
 * @param {string} opts.consumerName
 * @param {string} opts.deliveryAddress
 * @param {number} opts.distanceKm
 */
function notifyDealerDeliveryAssigned({
  dealerId,
  dealerName,
  orderNumber,
  consumerName,
  deliveryAddress,
  distanceKm,
}) {
  const title = `New delivery assigned — ${orderNumber}`;
  const body  = `Deliver to ${consumerName} (${distanceKm} km away). Address: ${deliveryAddress}`;
  const data  = JSON.stringify({ orderNumber, consumerName, deliveryAddress, distanceKm });

  const r = db.prepare(`
    INSERT INTO notifications (user_type, user_id, title, body, data, channel)
    VALUES ('dealer', ?, ?, ?, ?, 'in_app')
  `).run(dealerId, title, body, data);

  pushNotification('dealer', dealerId, {
    id: r.lastInsertRowid, title, body, data: JSON.parse(data), created_at: new Date().toISOString(),
  });
  console.log(`[NOTIFICATION] Dealer "${dealerName}" (id=${dealerId}): ${title}`);
}

/**
 * Send a notification to a consumer that their order has been assigned.
 *
 * @param {object} opts
 * @param {number} opts.consumerId
 * @param {string} opts.orderNumber
 * @param {string} opts.dealerName
 * @param {string} opts.dealerPhone
 */
function notifyConsumerDeliveryAssigned({
  consumerId,
  orderNumber,
  dealerName,
  dealerPhone,
}) {
  const title = `Delivery partner assigned — ${orderNumber}`;
  const body  = `${dealerName} (${dealerPhone}) will deliver your order.`;
  const data  = JSON.stringify({ orderNumber, dealerName, dealerPhone });

  const r = db.prepare(`
    INSERT INTO notifications (user_type, user_id, title, body, data, channel)
    VALUES ('consumer', ?, ?, ?, ?, 'in_app')
  `).run(consumerId, title, body, data);

  pushNotification('consumer', consumerId, {
    id: r.lastInsertRowid, title, body, data: JSON.parse(data), created_at: new Date().toISOString(),
  });
  console.log(`[NOTIFICATION] Consumer id=${consumerId}: ${title}`);
}

/**
 * Fetch unread notifications for a user.
 *
 * @param {'dealer'|'consumer'|'admin'} userType
 * @param {number} userId
 * @param {number} limit
 * @returns {object[]}
 */
function getUnreadNotifications(userType, userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_type = ? AND user_id = ? AND read = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userType, userId, limit);
}

/**
 * Fetch all notifications for a user (paginated).
 */
function getNotifications(userType, userId, limit = 50, offset = 0) {
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_type = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userType, userId, limit, offset);
}

/**
 * Mark a single notification as read.
 */
function markRead(notificationId, userType, userId) {
  return db.prepare(`
    UPDATE notifications SET read = 1
    WHERE id = ? AND user_type = ? AND user_id = ?
  `).run(notificationId, userType, userId);
}

/**
 * Mark all notifications as read for a user.
 */
function markAllRead(userType, userId) {
  return db.prepare(`
    UPDATE notifications SET read = 1
    WHERE user_type = ? AND user_id = ? AND read = 0
  `).run(userType, userId);
}

/**
 * Send a low-stock alert to all admin users.
 */
function notifyAdminLowStock({ dealer_name, product_name, quantity, low_stock_threshold, dealer_id, product_id }) {
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`).all();
  const title = `Low stock alert — ${dealer_name}`;
  const body  = `"${product_name}" is at ${quantity} units (threshold: ${low_stock_threshold})`;
  const data  = JSON.stringify({ dealer_id, product_id, quantity, low_stock_threshold });

  for (const admin of admins) {
    // Avoid duplicate alerts within 24 hours
    const recent = db.prepare(`
      SELECT id FROM notifications
      WHERE user_type = 'admin' AND user_id = ? AND title = ? AND created_at > datetime('now', '-24 hours')
    `).get(admin.id, title);
    if (recent) continue;

    db.prepare(`
      INSERT INTO notifications (user_type, user_id, title, body, data, channel)
      VALUES ('admin', ?, ?, ?, ?, 'in_app')
    `).run(admin.id, title, body, data);
  }

  console.log(`[LOW STOCK] ${dealer_name}: ${product_name} — ${quantity} units`);
}

/**
 * Notify a linked dealer that a consumer order was routed to a different
 * (nearest) dealer for delivery, based on H3 proximity.
 *
 * @param {object} opts
 * @param {number} opts.linkedDealerId   – the consumer's linked dealer
 * @param {string} opts.linkedDealerName
 * @param {string} opts.orderNumber
 * @param {string} opts.consumerName
 * @param {number} opts.deliveryDealerId – the dealer actually assigned
 * @param {string} opts.deliveryDealerName
 * @param {number} opts.distanceKm
 */
function notifyLinkedDealerOrderRouted({
  linkedDealerId,
  linkedDealerName,
  orderNumber,
  consumerName,
  deliveryDealerId,
  deliveryDealerName,
  distanceKm,
}) {
  const title = `Order routed to nearest dealer — ${orderNumber}`;
  const body  = `Your consumer ${consumerName}'s order has been assigned to ${deliveryDealerName} (${distanceKm.toFixed(1)} km from delivery address) for delivery. You still earn commission on this order.`;
  const data  = JSON.stringify({ orderNumber, consumerName, deliveryDealerId, deliveryDealerName, distanceKm });

  const r = db.prepare(`
    INSERT INTO notifications (user_type, user_id, title, body, data, channel)
    VALUES ('dealer', ?, ?, ?, ?, 'in_app')
  `).run(linkedDealerId, title, body, data);

  pushNotification('dealer', linkedDealerId, {
    id: r.lastInsertRowid, title, body, data: JSON.parse(data), created_at: new Date().toISOString(),
  });
  console.log(`[NOTIFICATION] Linked dealer "${linkedDealerName}" (id=${linkedDealerId}): ${title}`);
}

/* ── Exports ─────────────────────────────────────────────────────────── */

/**
 * Generic notification helper.
 * @param {'dealer'|'consumer'|'admin'} userType
 * @param {number} userId
 * @param {string} title
 * @param {string} body
 * @param {object} [data]
 */
function createNotification(userType, userId, title, body, data = {}) {
  const dataStr = JSON.stringify(data);
  const r = db.prepare(`
    INSERT INTO notifications (user_type, user_id, title, body, data, channel)
    VALUES (?, ?, ?, ?, ?, 'in_app')
  `).run(userType, userId, title, body, dataStr);
  pushNotification(userType, userId, {
    id: r.lastInsertRowid, title, body, data, created_at: new Date().toISOString(),
  });
}

module.exports = {
  notifyDealerDeliveryAssigned,
  notifyConsumerDeliveryAssigned,
  notifyLinkedDealerOrderRouted,
  notifyAdminLowStock,
  getUnreadNotifications,
  getNotifications,
  markRead,
  markAllRead,
  createNotification,
};
