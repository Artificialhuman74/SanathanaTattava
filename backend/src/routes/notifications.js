/**
 * Notification Routes
 *
 * Endpoints for dealers and consumers to read their in-app notifications.
 * Mounted at /api/notifications
 */

const express = require('express');
const { authenticate, requireTrader, requireAdmin } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const db  = require('../database/db');
const {
  getNotifications,
  getUnreadNotifications,
  markRead,
  markAllRead,
} = require('../services/notificationService');

const router = express.Router();

/* ── Consumer auth (inline — same as consumer.js) ────────────────────── */
const authConsumer = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'consumer') return res.status(403).json({ error: 'Consumer access only' });
    const c = db.prepare('SELECT * FROM consumers WHERE id=? AND status=?').get(decoded.id, 'active');
    if (!c) return res.status(401).json({ error: 'Consumer not found' });
    req.consumer = c;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/* ── Dealer notifications ────────────────────────────────────────────── */

router.get('/dealer', authenticate, requireTrader, (req, res) => {
  const unread = getUnreadNotifications('dealer', req.user.id);
  const all    = getNotifications('dealer', req.user.id);
  res.json({ unread_count: unread.length, notifications: all });
});

router.put('/dealer/:id/read', authenticate, requireTrader, (req, res) => {
  markRead(req.params.id, 'dealer', req.user.id);
  res.json({ success: true });
});

router.put('/dealer/read-all', authenticate, requireTrader, (_req, res) => {
  markAllRead('dealer', _req.user.id);
  res.json({ success: true });
});

/* ── Admin notifications ─────────────────────────────────────────────── */

router.get('/admin', authenticate, requireAdmin, (req, res) => {
  const unread = getUnreadNotifications('admin', req.user.id);
  const all    = getNotifications('admin', req.user.id);
  res.json({ unread_count: unread.length, notifications: all });
});

router.put('/admin/:id/read', authenticate, requireAdmin, (req, res) => {
  markRead(req.params.id, 'admin', req.user.id);
  res.json({ success: true });
});

router.put('/admin/read-all', authenticate, requireAdmin, (req, res) => {
  markAllRead('admin', req.user.id);
  res.json({ success: true });
});

/* ── Consumer notifications ──────────────────────────────────────────── */

router.get('/consumer', authConsumer, (req, res) => {
  const unread = getUnreadNotifications('consumer', req.consumer.id);
  const all    = getNotifications('consumer', req.consumer.id);
  res.json({ unread_count: unread.length, notifications: all });
});

router.put('/consumer/:id/read', authConsumer, (req, res) => {
  markRead(req.params.id, 'consumer', req.consumer.id);
  res.json({ success: true });
});

router.put('/consumer/read-all', authConsumer, (req, res) => {
  markAllRead('consumer', req.consumer.id);
  res.json({ success: true });
});

module.exports = router;
