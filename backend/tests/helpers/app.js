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

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/auth',          authRoutes);
  app.use('/api/admin',         adminRoutes);
  app.use('/api/trader',        traderRoutes);
  app.use('/api/consumer',      consumerRoutes);
  app.use('/api/location',      locationRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/delivery',      deliveryRoutes);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Global error handler
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
