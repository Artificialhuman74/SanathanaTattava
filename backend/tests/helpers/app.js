/**
 * Creates the Express app WITHOUT starting an HTTP server.
 * Supertest binds its own ephemeral port.
 */
const express = require('express');
const cors    = require('cors');

const authRoutes         = require('../../src/routes/auth');
const adminRoutes        = require('../../src/routes/admin');
const traderRoutes       = require('../../src/routes/trader');
const consumerRoutes     = require('../../src/routes/consumer');
const locationRoutes     = require('../../src/routes/location');
const notificationRoutes = require('../../src/routes/notifications');
const deliveryRoutes     = require('../../src/routes/delivery');
const publicRoutes       = require('../../src/routes/public');
const paymentsRoutes     = require('../../src/routes/payments');

const requestId = require('../../src/middleware/requestId');
const db = require('../../src/database/db');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(requestId);
  // Webhook needs raw bytes for HMAC verification — mount BEFORE json parser
  app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/auth',          authRoutes);
  app.use('/api/admin',         adminRoutes);
  app.use('/api/trader',        traderRoutes);
  app.use('/api/consumer',      consumerRoutes);
  app.use('/api/location',      locationRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/delivery',      deliveryRoutes);
  app.use('/api/public',        publicRoutes);
  app.use('/api/payments',      paymentsRoutes);

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'error', db: 'unreachable', error: err.message });
    }
  });

  // Global error handler — propagate HTTP status codes (e.g. 413 from body parser)
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
