/**
 * Location Routes
 *
 * Endpoints for dealers to update their GPS position and availability,
 * and for consumers to find nearby delivery dealers.
 *
 * Mounted at /api/location
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireTrader } = require('../middleware/auth');
const {
  latLngToH3Index,
  isValidCoordinate,
  haversineDistance,
} = require('../services/h3Service');
const { findNearbyDealers } = require('../services/deliveryAssignment');

const router = express.Router();

/* ═══════════════════════════════════════════════════════════════════════
 * DEALER ENDPOINTS (authenticated traders)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * PUT /api/location/dealer/update
 *
 * Update the authenticated dealer's lat/lng + recompute H3 index.
 * Called on login, periodically from a mobile app, or manually.
 */
router.put(
  '/dealer/update',
  authenticate,
  requireTrader,
  [
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  ],
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

    const { latitude, longitude } = req.body;
    const h3Index = latLngToH3Index(latitude, longitude);

    db.prepare(`
      UPDATE users
      SET    latitude  = ?,
             longitude = ?,
             h3_index  = ?
      WHERE  id = ?
    `).run(latitude, longitude, h3Index, req.user.id);

    res.json({
      success: true,
      location: { latitude, longitude, h3_index: h3Index },
    });
  },
);

/**
 * PUT /api/location/dealer/availability
 *
 * Toggle dealer's availability status.
 * Values: 'available' | 'busy' | 'offline'
 */
router.put(
  '/dealer/availability',
  authenticate,
  requireTrader,
  [
    body('status')
      .isIn(['available', 'busy', 'offline'])
      .withMessage('Status must be available, busy, or offline'),
  ],
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

    db.prepare(`UPDATE users SET availability_status = ? WHERE id = ?`)
      .run(req.body.status, req.user.id);

    res.json({ success: true, availability_status: req.body.status });
  },
);

/**
 * GET /api/location/dealer/me
 *
 * Return the dealer's current stored location + availability.
 */
router.get('/dealer/me', authenticate, requireTrader, (req, res) => {
  const dealer = db.prepare(`
    SELECT id, name, latitude, longitude, h3_index, availability_status,
           will_deliver, delivery_enabled
    FROM   users WHERE id = ?
  `).get(req.user.id);

  res.json({ location: dealer });
});

/* ═══════════════════════════════════════════════════════════════════════
 * PUBLIC / CONSUMER ENDPOINTS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/location/nearby-dealers?lat=...&lng=...&limit=5
 *
 * Find available delivery dealers near a given point.
 * Useful for showing the consumer which dealer will deliver.
 */
router.get(
  '/nearby-dealers',
  [
    query('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid lat required'),
    query('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid lng required'),
    query('limit').optional().isInt({ min: 1, max: 20 }),
  ],
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

    const lat   = parseFloat(req.query.lat);
    const lng   = parseFloat(req.query.lng);
    const limit = parseInt(req.query.limit || '5', 10);

    const results = findNearbyDealers(lat, lng, limit);

    res.json({
      dealers: results.map(r => ({
        id:                  r.dealer.id,
        name:                r.dealer.name,
        phone:               r.dealer.phone,
        tier:                r.dealer.tier,
        referral_code:       r.dealer.referral_code,
        availability_status: r.dealer.availability_status,
        distance_km:         r.distanceKm,
      })),
    });
  },
);

module.exports = router;
