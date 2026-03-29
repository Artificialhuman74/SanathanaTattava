/**
 * WebSocket Server (Socket.IO)
 *
 * Room-based real-time event system for TradeHub.
 *
 * Rooms:
 *   consumer:<id>   – per-consumer updates (order status, delivery tracking)
 *   trader:<id>     – per-trader updates (new orders, delivery routing)
 *   admin           – all order/system events
 *
 * Auth: clients send JWT on connection; server validates + auto-joins rooms.
 */

const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const db         = require('../database/db');

let io = null;

/* ── Initialise ─────────────────────────────────────────────────────── */

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    pingInterval: 25000,   // keep-alive every 25 s
    pingTimeout:  20000,   // disconnect after 20 s silence
    transports: ['websocket', 'polling'],
  });

  io.use(authenticateSocket);
  io.on('connection', handleConnection);

  console.log('[ws] Socket.IO server initialised');
  return io;
}

/* ── Auth middleware ─────────────────────────────────────────────────── */

function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No auth token'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;                       // { id, role, ... }
    next();
  } catch {
    next(new Error('Invalid token'));
  }
}

/* ── Connection handler ─────────────────────────────────────────────── */

function handleConnection(socket) {
  const { id, role } = socket.user;

  // Auto-join role-based room
  if (role === 'admin')    socket.join('admin');
  if (role === 'trader')   socket.join(`trader:${id}`);
  if (role === 'consumer') socket.join(`consumer:${id}`);

  console.log(`[ws] ${role}:${id} connected  (socket ${socket.id})`);

  // Allow clients to join specific order rooms for live tracking
  socket.on('track_order', (orderId) => {
    if (typeof orderId !== 'number') return;
    socket.join(`order:${orderId}`);
  });

  socket.on('untrack_order', (orderId) => {
    socket.leave(`order:${orderId}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[ws] ${role}:${id} disconnected (${reason})`);
  });
}

/* ── Emit helpers (called from route handlers) ──────────────────────── */

/**
 * Broadcast an order status change to all relevant parties.
 *
 * @param {object} opts
 * @param {number} opts.orderId
 * @param {string} opts.orderNumber
 * @param {string} opts.status            – order status
 * @param {string} [opts.deliveryStatus]  – delivery_status
 * @param {number} [opts.consumerId]
 * @param {number} [opts.linkedDealerId]
 * @param {number} [opts.deliveryDealerId]
 * @param {object} [opts.extra]           – any additional payload
 */
function emitOrderUpdate(opts) {
  if (!io) return;

  const payload = {
    orderId:        opts.orderId,
    orderNumber:    opts.orderNumber,
    status:         opts.status,
    deliveryStatus: opts.deliveryStatus || null,
    timestamp:      new Date().toISOString(),
    ...opts.extra,
  };

  // Emit to the specific order room (for live tracking pages)
  io.to(`order:${opts.orderId}`).emit('order_status_updated', payload);

  // Emit to the consumer who placed it
  if (opts.consumerId) {
    io.to(`consumer:${opts.consumerId}`).emit('order_status_updated', payload);
  }

  // Emit to the linked (referral) dealer
  if (opts.linkedDealerId) {
    io.to(`trader:${opts.linkedDealerId}`).emit('order_status_updated', payload);
  }

  // Emit to the delivery dealer (may differ from linked dealer)
  if (opts.deliveryDealerId && opts.deliveryDealerId !== opts.linkedDealerId) {
    io.to(`trader:${opts.deliveryDealerId}`).emit('order_status_updated', payload);
  }

  // Always emit to admin
  io.to('admin').emit('order_status_updated', payload);
}

/**
 * Push a notification to a specific user in real time.
 *
 * @param {'dealer'|'consumer'|'admin'} userType
 * @param {number} userId
 * @param {object} notification  – { id, title, body, data, created_at }
 */
function emitNotification(userType, userId, notification) {
  if (!io) return;

  const room = userType === 'admin'
    ? 'admin'
    : userType === 'dealer' || userType === 'trader'
      ? `trader:${userId}`
      : `consumer:${userId}`;

  io.to(room).emit('notification', notification);
}

/**
 * Broadcast a generic event to the admin room.
 */
function emitAdminEvent(event, data) {
  if (!io) return;
  io.to('admin').emit(event, { ...data, timestamp: new Date().toISOString() });
}

/**
 * Get the Socket.IO instance (for advanced use).
 */
function getIO() {
  return io;
}

/* ── Exports ────────────────────────────────────────────────────────── */

module.exports = {
  initSocket,
  getIO,
  emitOrderUpdate,
  emitNotification,
  emitAdminEvent,
};
