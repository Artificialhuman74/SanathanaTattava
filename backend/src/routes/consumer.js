const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');

const { isValidCoordinate, latLngToH3Index } = require('../services/h3Service');
const { findNearestDealer } = require('../services/deliveryAssignment');
const { geocodeAddress, geocodeFromCoordinates } = require('../services/geocodingService');
const {
  notifyDealerDeliveryAssigned,
  notifyConsumerDeliveryAssigned,
  notifyLinkedDealerOrderRouted,
  notifyContainerRefundRequested,
} = require('../services/notificationService');
const { createNotification } = require('../services/notificationService');
const { sendAdminDisputeOpenedEmail } = require('../services/emailService');
const { emitOrderUpdate, emitContainerHoldingUpdate } = require('../websocket/socketServer');
const containerHoldings = require('../services/containerHoldingsService');
const storeCredit       = require('../services/storeCreditService');
const { safeConsumer }  = require('../utils/safeConsumer');

const router = express.Router();

/* ── Consumer Auth Middleware ─────────────────────────────────────────── */
const authConsumer = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'consumer') return res.status(403).json({ error: 'Consumer access only' });
    const c = db.prepare('SELECT * FROM consumers WHERE id=? AND status=?').get(decoded.id, 'active');
    if (!c) return res.status(401).json({ error: 'Consumer not found' });
    delete c.password;
    req.consumer = c;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/* Helper: get referral discount from settings */
const getReferralDiscount = () => {
  const row = db.prepare(`SELECT value FROM settings WHERE key='referral_discount_percent'`).get();
  return row ? parseFloat(row.value) : 10;
};

/* ── Public: Settings (discount %) ───────────────────────────────────── */
router.get('/settings', (_req, res) => {
  res.json({ referral_discount_percent: getReferralDiscount() });
});

/* ── Public: Browse Products ──────────────────────────────────────────── */
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

router.get('/products/:id', (req, res) => {
  const product = db.prepare(`SELECT * FROM products WHERE id=? AND status='active'`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

/* ── Auth: Refill caps per product ────────────────────────────────────
 * Returns the count of 'held' container_holdings rows grouped by
 * current_product_id for the calling consumer. Used by the Shop UI to
 * decide when to show the "Refill" CTA and to cap refill quantity.
 * Pending-delivery and refund-requested rows are excluded. */
router.get('/refill-caps', authConsumer, (req, res) => {
  const rows = db.prepare(`
    SELECT current_product_id AS product_id, COUNT(*) AS held
    FROM container_holdings
    WHERE consumer_id = ? AND status = 'held'
    GROUP BY current_product_id
  `).all(req.consumer.id);
  const caps = {};
  rows.forEach(r => { caps[r.product_id] = r.held; });
  res.json({ caps });
});

/* ── My Containers (Phase 5) ────────────────────────────────────────────
 * GET  /consumer/containers                          → { held, history, swappable }
 * POST /consumer/containers/:id/request-refund       → opt-out flow
 * POST /consumer/containers/:id/cancel-refund        → undo opt-out
 * POST /consumer/containers/:id/swap                 → same-size product swap
 */
router.get('/containers', authConsumer, (req, res) => {
  const held    = containerHoldings.getHeldContainers(req.consumer.id);
  const history = containerHoldings.getAllHoldingsForConsumer(req.consumer.id);
  /* Same-size swap targets, indexed by container_type. The frontend uses
   * this to populate the swap modal's product picker. */
  const swappable = db.prepare(`
    SELECT id, name, unit, container_type, price
      FROM products
     WHERE status='active' AND container_type IS NOT NULL
     ORDER BY container_type, name
  `).all();
  const waRow = db.prepare(`SELECT value FROM settings WHERE key='support_whatsapp_number'`).get();
  res.json({
    held, history, swappable,
    support_whatsapp_number: waRow?.value || null,
  });
});

const handleHoldingError = (e, res) => {
  if (e.code === 'NOT_FOUND')         return res.status(404).json({ error: e.message });
  if (e.code === 'INVALID_STATUS')    return res.status(409).json({ error: e.message });
  if (e.code === 'INVALID_DESTINATION') return res.status(400).json({ error: e.message });
  if (e.code === 'SIZE_MISMATCH')     return res.status(400).json({ error: e.message });
  if (e.code === 'NO_CHANGE')         return res.status(400).json({ error: e.message });
  if (e.code === 'FORBIDDEN')         return res.status(403).json({ error: e.message });
  if (e.code === 'WINDOW_CLOSED')     return res.status(410).json({ error: e.message });
  if (e.code === 'ALREADY_RESOLVED')  return res.status(409).json({ error: e.message });
  console.error('[containers] unexpected error', e);
  return res.status(500).json({ error: 'Internal error' });
};

router.post('/containers/:id/request-refund',
  authConsumer,
  body('destination').isIn(['manual_bank', 'store_credit']),
  body('notes').optional().isString().isLength({ max: 500 }),
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const holdingId = parseInt(req.params.id, 10);
    try {
      containerHoldings.requestRefund({
        holdingId,
        consumerId: req.consumer.id,
        destination: req.body.destination,
        notes: req.body.notes,
      });

      /* Fan out: linked dealer + every admin. Linked dealer is the pickup
       * party regardless of distance. Errors are non-fatal. */
      try {
        const ctx = db.prepare(`
          SELECT h.id AS holding_id, h.container_type,
                 p.name AS product_name,
                 c.id AS consumer_id, c.name AS consumer_name, c.phone AS consumer_phone,
                 c.linked_dealer_id,
                 u.name AS linked_dealer_name, u.email AS linked_dealer_email,
                 (SELECT a.address || ', ' || a.pincode FROM consumer_addresses a
                   WHERE a.consumer_id = c.id AND a.is_default = 1 LIMIT 1) AS consumer_address
            FROM container_holdings h
            JOIN products  p ON p.id = h.current_product_id
            JOIN consumers c ON c.id = h.consumer_id
            LEFT JOIN users u ON u.id = c.linked_dealer_id
           WHERE h.id = ?
        `).get(holdingId);
        if (ctx) {
          notifyContainerRefundRequested({
            holdingId: ctx.holding_id,
            consumerId: ctx.consumer_id,
            consumerName: ctx.consumer_name,
            consumerPhone: ctx.consumer_phone,
            consumerAddress: ctx.consumer_address,
            linkedDealerId: ctx.linked_dealer_id,
            linkedDealerName: ctx.linked_dealer_name,
            linkedDealerEmail: ctx.linked_dealer_email,
            productName: ctx.product_name,
            containerType: ctx.container_type,
            destination: req.body.destination,
            notes: req.body.notes,
          });
          emitContainerHoldingUpdate({
            holdingId:      ctx.holding_id,
            consumerId:     ctx.consumer_id,
            linkedDealerId: ctx.linked_dealer_id,
            event:          'refund_requested',
          });
        }
      } catch (notifyErr) {
        console.error('[container-refund notify] failed:', notifyErr.message);
      }

      res.json({ ok: true });
    } catch (e) { handleHoldingError(e, res); }
  }
);

router.post('/containers/:id/cancel-refund', authConsumer, (req, res) => {
  const holdingId = parseInt(req.params.id, 10);
  try {
    containerHoldings.cancelRefund({ holdingId, consumerId: req.consumer.id });
    try {
      const ctx = db.prepare(`
        SELECT c.linked_dealer_id FROM container_holdings h
          JOIN consumers c ON c.id = h.consumer_id WHERE h.id=?
      `).get(holdingId);
      emitContainerHoldingUpdate({
        holdingId,
        consumerId: req.consumer.id,
        linkedDealerId: ctx?.linked_dealer_id,
        event: 'refund_cancelled',
      });
    } catch (_) {}
    res.json({ ok: true });
  } catch (e) { handleHoldingError(e, res); }
});

router.post('/containers/:id/swap',
  authConsumer,
  body('target_product_id').isInt({ min: 1 }),
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const holdingId = parseInt(req.params.id, 10);
    try {
      containerHoldings.requestSwap({
        holdingId,
        consumerId: req.consumer.id,
        targetProductId: parseInt(req.body.target_product_id, 10),
      });
      emitContainerHoldingUpdate({
        holdingId,
        consumerId: req.consumer.id,
        event: 'swap_requested',
      });
      res.json({ ok: true });
    } catch (e) { handleHoldingError(e, res); }
  }
);

/* Phase 9 — consumer opens a damage dispute against a forfeited holding.
 * Only allowed while we are still inside the 48h window stamped on the
 * holding at forfeit time. Fans out an admin notification + email. */
router.post('/containers/:id/dispute',
  authConsumer,
  body('notes').optional().isString().isLength({ max: 1000 }),
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const holdingId = parseInt(req.params.id, 10);
    try {
      containerHoldings.openDamageDispute({
        holdingId,
        consumerId: req.consumer.id,
        notes: req.body.notes,
      });

      try {
        const ctx = db.prepare(`
          SELECT h.id, h.container_type, h.deposit_amount,
                 c.id AS consumer_id, c.name AS consumer_name, c.phone AS consumer_phone
            FROM container_holdings h
            JOIN consumers c ON c.id = h.consumer_id
           WHERE h.id = ?
        `).get(holdingId);

        const admins = db.prepare(`SELECT id, email FROM users WHERE role='admin'`).all();
        const title = 'Damage dispute opened';
        const body  = `${ctx.consumer_name} is disputing a forfeited ${ctx.container_type} deposit of ₹${ctx.deposit_amount}.`;
        for (const a of admins) {
          createNotification('admin', a.id, title, body, { holding_id: ctx.id, consumer_id: ctx.consumer_id });
        }
        sendAdminDisputeOpenedEmail({
          consumerName:  ctx.consumer_name,
          consumerPhone: ctx.consumer_phone,
          holdingId:     ctx.id,
          containerType: ctx.container_type,
          depositAmount: ctx.deposit_amount,
          consumerNotes: req.body.notes || '',
        }).catch(err => console.error('[dispute email] failed:', err.message));
        emitContainerHoldingUpdate({
          holdingId: ctx.id,
          consumerId: ctx.consumer_id,
          event: 'dispute_opened',
        });
      } catch (notifyErr) {
        console.error('[dispute notify] failed:', notifyErr.message);
      }

      res.json({ ok: true });
    } catch (e) { handleHoldingError(e, res); }
  }
);

/* ── Phase 7: store credit wallet ─────────────────────────────────────── */
router.get('/store-credit', authConsumer, (req, res) => {
  try {
    const balance = storeCredit.getBalance(req.consumer.id);
    const ledger  = storeCredit.getLedger(req.consumer.id, { limit: 50 });
    res.json({ balance, ledger });
  } catch (err) {
    console.error('GET /consumer/store-credit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Auth: Consumer Me ────────────────────────────────────────────────── */
router.get('/me', authConsumer, (req, res) => {
  const consumer = safeConsumer(req.consumer);
  if (consumer.linked_dealer_id) {
    const dealer = db.prepare(`SELECT id,name,phone,tier,referral_code FROM users WHERE id=?`).get(consumer.linked_dealer_id);
    consumer.dealer = dealer;
    if (dealer?.tier === 2 && dealer.referred_by_id) {
      consumer.parentDealer = db.prepare(`SELECT id,name,phone FROM users WHERE id=?`).get(dealer.referred_by_id);
    } else if (dealer?.tier === 1) {
      consumer.parentDealer = dealer;
    }
  }
  res.json({ consumer });
});

/* ── GET /me/export — GDPR data export ───────────────────────────────── */
router.get('/me/export', authConsumer, (req, res) => {
  const consumer = db.prepare('SELECT id,name,email,phone,address,pincode,created_at FROM consumers WHERE id=?').get(req.consumer.id);
  const orders   = db.prepare('SELECT id,order_number,status,payment_status,total_amount,created_at FROM consumer_orders WHERE consumer_id=? AND payment_status != \'pending\'').all(req.consumer.id);
  const addresses = db.prepare('SELECT label,name,address,pincode FROM consumer_addresses WHERE consumer_id=?').all(req.consumer.id);
  res.json({ consumer, orders, addresses });
});

/* ── DELETE /me — soft-delete consumer account ────────────────────────── */
router.delete('/me', authConsumer, (req, res) => {
  const id = req.consumer.id;
  db.prepare(`UPDATE consumers SET status='deleted', email=email||'__deleted_'||id, name='[Deleted]', phone=NULL WHERE id=?`).run(id);
  res.json({ success: true });
});

/* ── PATCH /me — update name / phone ─────────────────────────────────── */
router.patch('/me', authConsumer, (req, res) => {
  const { name, phone } = req.body;
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  const updates = [];
  const params  = [];
  if (name  !== undefined) { updates.push('name = ?');  params.push(String(name).trim()); }
  if (phone !== undefined) { updates.push('phone = ?'); params.push(phone ? String(phone).trim() : null); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.consumer.id);
  db.prepare(`UPDATE consumers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM consumers WHERE id = ?').get(req.consumer.id);
  res.json({ consumer: safeConsumer(updated) });
});

/* ── POST /change-password ────────────────────────────────────────────── */
router.post('/change-password', authConsumer, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const consumer = db.prepare('SELECT * FROM consumers WHERE id = ?').get(req.consumer.id);
  const valid = await bcrypt.compare(old_password, consumer.password);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE consumers SET password = ? WHERE id = ?').run(hash, req.consumer.id);
  res.json({ success: true });
});

/* ── Auth: Saved Addresses ────────────────────────────────────────────── */

router.get('/addresses', authConsumer, (req, res) => {
  const addresses = db.prepare(`SELECT * FROM consumer_addresses WHERE consumer_id=? ORDER BY is_default DESC, created_at ASC`).all(req.consumer.id);
  res.json({ addresses });
});

router.post('/addresses', authConsumer, [
  body('label').trim().notEmpty().withMessage('Label is required'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('pincode').trim().notEmpty().withMessage('Pincode is required'),
  body('is_default').optional().isBoolean(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  const { label, name, phone, address, pincode, is_default } = req.body;
  const makeDefault = is_default ? 1 : 0;
  if (makeDefault) db.prepare(`UPDATE consumer_addresses SET is_default=0 WHERE consumer_id=?`).run(req.consumer.id);

  // Geocode: use provided lat/lng or auto-geocode from address text
  let latitude = null, longitude = null, h3_index = null;
  const reqLat = parseFloat(req.body.latitude);
  const reqLng = parseFloat(req.body.longitude);
  if (isValidCoordinate(reqLat, reqLng)) {
    const geo = geocodeFromCoordinates(reqLat, reqLng);
    if (geo) { latitude = geo.latitude; longitude = geo.longitude; h3_index = geo.h3_index; }
  } else {
    // Auto-geocode from address text via Nominatim
    try {
      const geo = await geocodeAddress(address, pincode);
      if (geo) { latitude = geo.latitude; longitude = geo.longitude; h3_index = geo.h3_index; }
    } catch (e) { console.error('[address geocode] failed:', e.message); }
  }

  const r = db.prepare(`INSERT INTO consumer_addresses (consumer_id,label,name,phone,address,pincode,is_default,latitude,longitude,h3_index) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(req.consumer.id, label, name, phone, address, pincode, makeDefault, latitude, longitude, h3_index);
  const created = db.prepare(`SELECT * FROM consumer_addresses WHERE id=?`).get(r.lastInsertRowid);
  res.status(201).json({ address: created, geocoded: !!(latitude && longitude) });
});

router.put('/addresses/:id', authConsumer, [
  body('label').optional().trim().notEmpty(),
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim().notEmpty(),
  body('address').optional().trim().notEmpty(),
  body('pincode').optional().trim().notEmpty(),
  body('is_default').optional().isBoolean(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
], async (req, res) => {
  const existing = db.prepare(`SELECT * FROM consumer_addresses WHERE id=? AND consumer_id=?`).get(req.params.id, req.consumer.id);
  if (!existing) return res.status(404).json({ error: 'Address not found' });
  const { label, name, phone, address, pincode, is_default } = req.body;
  const makeDefault = is_default != null ? (is_default ? 1 : 0) : existing.is_default;
  if (makeDefault && !existing.is_default) db.prepare(`UPDATE consumer_addresses SET is_default=0 WHERE consumer_id=?`).run(req.consumer.id);

  const finalAddress = address ?? existing.address;
  const finalPincode = pincode ?? existing.pincode;

  // Re-geocode if address or pincode changed
  let latitude = existing.latitude, longitude = existing.longitude, h3_index = existing.h3_index;
  const addressChanged = (address && address !== existing.address) || (pincode && pincode !== existing.pincode);

  const reqLat = parseFloat(req.body.latitude);
  const reqLng = parseFloat(req.body.longitude);
  if (isValidCoordinate(reqLat, reqLng)) {
    const geo = geocodeFromCoordinates(reqLat, reqLng);
    if (geo) { latitude = geo.latitude; longitude = geo.longitude; h3_index = geo.h3_index; }
  } else if (addressChanged || (!existing.latitude && !existing.longitude)) {
    // Auto-geocode from updated address text
    try {
      const geo = await geocodeAddress(finalAddress, finalPincode);
      if (geo) { latitude = geo.latitude; longitude = geo.longitude; h3_index = geo.h3_index; }
    } catch (e) { console.error('[address geocode] failed:', e.message); }
  }

  db.prepare(`UPDATE consumer_addresses SET label=?,name=?,phone=?,address=?,pincode=?,is_default=?,latitude=?,longitude=?,h3_index=? WHERE id=?`)
    .run(label ?? existing.label, name ?? existing.name, phone ?? existing.phone, finalAddress, finalPincode, makeDefault, latitude, longitude, h3_index, existing.id);
  const updated = db.prepare(`SELECT * FROM consumer_addresses WHERE id=?`).get(existing.id);
  res.json({ address: updated, geocoded: !!(latitude && longitude) });
});

router.delete('/addresses/:id', authConsumer, (req, res) => {
  const existing = db.prepare(`SELECT * FROM consumer_addresses WHERE id=? AND consumer_id=?`).get(req.params.id, req.consumer.id);
  if (!existing) return res.status(404).json({ error: 'Address not found' });
  db.prepare(`DELETE FROM consumer_addresses WHERE id=?`).run(existing.id);
  /* If deleted address was default, promote the most recent remaining address */
  if (existing.is_default) {
    const next = db.prepare(`SELECT id FROM consumer_addresses WHERE consumer_id=? ORDER BY created_at DESC LIMIT 1`).get(req.consumer.id);
    if (next) db.prepare(`UPDATE consumer_addresses SET is_default=1 WHERE id=?`).run(next.id);
  }
  res.json({ success: true });
});

/**
 * POST /consumer/addresses/:id/geocode
 *
 * Map an address to lat/lng/H3. Two modes:
 *   1. Send { latitude, longitude } — use browser GPS directly (most reliable)
 *   2. Send nothing — auto-geocode from address text via Nominatim
 */
router.post('/addresses/:id/geocode', authConsumer, [
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
], async (req, res) => {
  const existing = db.prepare(`SELECT * FROM consumer_addresses WHERE id=? AND consumer_id=?`).get(req.params.id, req.consumer.id);
  if (!existing) return res.status(404).json({ error: 'Address not found' });

  const reqLat = parseFloat(req.body.latitude);
  const reqLng = parseFloat(req.body.longitude);

  // Mode 1: Browser GPS coordinates provided
  if (isValidCoordinate(reqLat, reqLng)) {
    const geo = geocodeFromCoordinates(reqLat, reqLng);
    if (!geo) return res.status(400).json({ error: 'Invalid coordinates' });

    db.prepare(`UPDATE consumer_addresses SET latitude=?, longitude=?, h3_index=? WHERE id=?`)
      .run(geo.latitude, geo.longitude, geo.h3_index, existing.id);

    const updated = db.prepare(`SELECT * FROM consumer_addresses WHERE id=?`).get(existing.id);
    return res.json({ address: updated, geocoded: true, method: 'gps' });
  }

  // Mode 2: Auto-geocode from address text
  try {
    const geo = await geocodeAddress(existing.address, existing.pincode);
    if (!geo) return res.status(422).json({ error: 'Could not map this address automatically. Use "Use my location" to map it with GPS instead.' });

    db.prepare(`UPDATE consumer_addresses SET latitude=?, longitude=?, h3_index=? WHERE id=?`)
      .run(geo.latitude, geo.longitude, geo.h3_index, existing.id);

    const updated = db.prepare(`SELECT * FROM consumer_addresses WHERE id=?`).get(existing.id);
    res.json({ address: updated, geocoded: true, method: 'nominatim' });
  } catch (e) {
    console.error('[geocode] error:', e.message);
    res.status(500).json({ error: 'Geocoding service temporarily unavailable. Try "Use my location" instead.' });
  }
});

router.put('/addresses/:id/default', authConsumer, (req, res) => {
  const existing = db.prepare(`SELECT * FROM consumer_addresses WHERE id=? AND consumer_id=?`).get(req.params.id, req.consumer.id);
  if (!existing) return res.status(404).json({ error: 'Address not found' });
  db.prepare(`UPDATE consumer_addresses SET is_default=0 WHERE consumer_id=?`).run(req.consumer.id);
  db.prepare(`UPDATE consumer_addresses SET is_default=1 WHERE id=?`).run(existing.id);
  res.json({ success: true });
});

/* ── Auth: Place Order ────────────────────────────────────────────────── */
router.post('/orders', authConsumer, [
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.product_id').isInt({ min: 1 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.is_refill').optional().isBoolean(),
  /* Accept either a saved address id OR inline fields */
  body('address_id').optional().isInt({ min: 1 }),
  body('delivery_address').optional().trim(),
  body('pincode').optional().trim(),
  body('delivery_name').optional().trim(),
  body('delivery_phone').optional().trim(),
  body('save_address').optional().isBoolean(),
  body('make_default_address').optional().isBoolean(),
  body('address_label').optional().trim(),
  body('notes').optional().trim(),
  body('referral_code').optional().trim(),
  /* Geo fields for H3-based delivery assignment */
  body('delivery_latitude').optional().isFloat({ min: -90, max: 90 }),
  body('delivery_longitude').optional().isFloat({ min: -180, max: 180 }),
  /* Phase 7 — wallet credit applied to this order. Capped server-side. */
  body('store_credit_to_apply').optional().isFloat({ min: 0 }),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { items, address_id, notes, referral_code, save_address, make_default_address, address_label } = req.body;

  /* Resolve delivery address */
  let delivery_address, pincode, delivery_name, delivery_phone;
  let savedAddrLat = null, savedAddrLng = null;
  if (address_id) {
    const saved = db.prepare(`SELECT * FROM consumer_addresses WHERE id=? AND consumer_id=?`).get(address_id, req.consumer.id);
    if (!saved) return res.status(400).json({ error: 'Saved address not found' });
    delivery_address = saved.address;
    pincode          = saved.pincode;
    delivery_name    = saved.name;
    delivery_phone   = saved.phone;
    // Pull lat/lng/h3 from saved address if available (for H3 lookup)
    if (saved.latitude && saved.longitude) {
      savedAddrLat = saved.latitude;
      savedAddrLng = saved.longitude;
    }
  } else {
    delivery_address = (req.body.delivery_address || '').trim();
    pincode          = (req.body.pincode || '').trim();
    delivery_name    = (req.body.delivery_name || '').trim();
    delivery_phone   = (req.body.delivery_phone || '').trim();
    if (!delivery_address) return res.status(400).json({ error: 'Delivery address required' });
    if (!pincode)          return res.status(400).json({ error: 'Pincode required' });
  }
  const consumer = req.consumer;

  /* Backfill consumer.phone from delivery_phone for consumers who signed up
   * via Google (no phone yet). Required so the delivery handover OTP can be
   * sent to a known number. */
  if (!consumer.phone && delivery_phone) {
    const existing = db.prepare('SELECT id FROM consumers WHERE phone = ? AND id != ?')
      .get(delivery_phone, consumer.id);
    if (!existing) {
      db.prepare('UPDATE consumers SET phone = ? WHERE id = ?').run(delivery_phone, consumer.id);
      consumer.phone = delivery_phone;
    }
  }
  if (!consumer.phone && !delivery_phone) {
    return res.status(400).json({ error: 'A phone number is required for delivery.' });
  }

  /* Determine linked dealer (consumer's own or from checkout code) */
  let linkedDealerId = consumer.linked_dealer_id ?? null;
  if (!linkedDealerId && referral_code && referral_code.trim()) {
    const dealer = db.prepare(`SELECT id FROM users WHERE referral_code=? AND role='trader' AND status='active' AND pan_verified=1`).get(referral_code.trim());
    if (dealer) {
      linkedDealerId = dealer.id;
      // Permanently link this consumer to the dealer
      db.prepare(`UPDATE consumers SET linked_dealer_id = ?, referral_code_used = ? WHERE id = ?`)
        .run(dealer.id, referral_code.trim(), consumer.id);
    }
  }

  const isDirect = linkedDealerId === null ? 1 : 0;

  /* Discount: only for referral-linked consumers */
  const discPct = isDirect ? 0 : getReferralDiscount();

  /* ── Determine delivery dealer ───────────────────────────────────── */
  /*
   * Strategy:
   *   1. If customer provides lat/lng → use H3 spatial search
   *      to find the nearest *available* delivery dealer.
   *   2. Fallback: use the legacy referral-chain logic
   *      (linked dealer or their parent if delivery-enabled).
   *   3. Direct orders (no referral): admin handles delivery.
   *
   * IMPORTANT: The *referral* dealer earns commission regardless.
   *            The *delivery* dealer may be a completely different person.
   */
  let deliveryDealerId = null;
  let deliveryDistanceKm = null;
  let deliveryH3Index    = null;

  // Use explicit lat/lng from request, or fall back to saved address coordinates
  let customerLat = parseFloat(req.body.delivery_latitude) || savedAddrLat;
  let customerLng = parseFloat(req.body.delivery_longitude) || savedAddrLng;
  let hasGeo      = isValidCoordinate(customerLat, customerLng);

  // If no coordinates yet, auto-geocode from address text (async, best-effort)
  if (!hasGeo && delivery_address) {
    try {
      const geo = await geocodeAddress(delivery_address, pincode);
      if (geo) {
        customerLat = geo.latitude;
        customerLng = geo.longitude;
        hasGeo = true;
        console.log(`[order geocode] "${delivery_address}" → ${geo.latitude}, ${geo.longitude} → H3: ${geo.h3_index}`);
      }
    } catch (e) {
      console.error('[order geocode] failed:', e.message);
      // Non-fatal — order proceeds without geo assignment
    }
  }

  if (hasGeo) {
    deliveryH3Index = latLngToH3Index(customerLat, customerLng);

    // H3 spatial search: find the nearest available dealer
    const nearest = findNearestDealer(customerLat, customerLng);
    if (nearest) {
      deliveryDealerId   = nearest.dealer.id;
      deliveryDistanceKm = nearest.distanceKm;
    }
  }

  // Fallback: legacy referral-chain assignment (if H3 found nobody)
  if (!deliveryDealerId && !isDirect) {
    const dealer = db.prepare(`SELECT * FROM users WHERE id=?`).get(linkedDealerId);
    if (dealer?.delivery_enabled && dealer?.will_deliver && dealer?.pan_verified) {
      deliveryDealerId = dealer.id;
    } else if (dealer?.tier === 2 && dealer.referred_by_id) {
      const parent = db.prepare(`SELECT * FROM users WHERE id=?`).get(dealer.referred_by_id);
      if (parent?.delivery_enabled && parent?.will_deliver && parent?.pan_verified) deliveryDealerId = parent.id;
    }
  }
  /* Relaxed trader fallback before admin. H3 + referral-chain are strict
   * (require availability_status='available' and an in-range H3 cell). If
   * those return nothing, try ANY active delivery-capable trader before
   * landing the order on admin. Prefer same pincode, then same pin-prefix
   * (~district), then any. Admin can still reassign manually later. */
  if (!deliveryDealerId) {
    const pin       = String(pincode || '');
    const pinPrefix = pin.slice(0, 3);
    const fallback  = db.prepare(`
      SELECT id FROM users
       WHERE role='trader' AND status='active'
         AND delivery_enabled=1 AND will_deliver=1
         AND pan_verified=1
       ORDER BY
         CASE WHEN pincode = ?           THEN 0
              WHEN substr(pincode,1,3) = ? THEN 1
              ELSE 2 END,
         id
       LIMIT 1
    `).get(pin, pinPrefix);
    if (fallback) {
      deliveryDealerId = fallback.id;
      console.log(`[order assign] H3+chain found nobody → relaxed fallback picked trader ${fallback.id}`);
    }
  }

  // Final fallback: assign to admin only if NO trader at all can deliver
  let assignmentStatus = deliveryDealerId ? 'assigned' : 'unassigned';
  if (!deliveryDealerId) {
    const admin = db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1`).get();
    if (admin) {
      deliveryDealerId = admin.id;
      assignmentStatus = 'admin';
      console.log(`[order assign] no eligible trader anywhere — assigning to admin (last resort)`);
    }
  }

  /* Validate items (outside transaction — read-only checks).
   * Each item may carry an `is_refill` flag. Refill items don't charge a
   * container deposit, but the aggregate refill quantity per product must
   * not exceed the consumer's held-container cap. */
  let subtotal = 0;
  const resolved = [];
  /* Per-product totals consolidated across cart lines (a consumer may have
   * both a Refill line and a Buy-more line for the same product) — used for
   * stock check and refill cap validation. */
  const stockNeeded = new Map();   // product_id → total qty (refill + buy)
  const refillWanted = new Map();  // product_id → total refill qty

  for (const item of items) {
    const product = db.prepare(`SELECT * FROM products WHERE id=? AND status='active'`).get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product #${item.product_id} not found` });
    const isRefill = !!item.is_refill;
    if (isRefill && !product.container_type) {
      return res.status(400).json({ error: `${product.name} is not a refillable product` });
    }
    stockNeeded.set(item.product_id, (stockNeeded.get(item.product_id) || 0) + item.quantity);
    if (isRefill) {
      refillWanted.set(item.product_id, (refillWanted.get(item.product_id) || 0) + item.quantity);
    }
    const total = product.price * item.quantity;
    subtotal += total;
    resolved.push({
      ...item,
      is_refill: isRefill,
      price: product.price,
      unit_container_cost: product.container_cost || 0,
      total,
      name: product.name,
      container_type: product.container_type || null,
    });
  }

  /* Stock check (after consolidating per-product qty) */
  for (const [pid, qty] of stockNeeded) {
    const product = db.prepare(`SELECT name, stock FROM products WHERE id=?`).get(pid);
    if (product.stock < qty) return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
  }

  /* Refill cap check — held containers per product for this consumer */
  if (refillWanted.size > 0) {
    const heldRows = db.prepare(`
      SELECT current_product_id AS pid, COUNT(*) AS held
      FROM container_holdings
      WHERE consumer_id = ? AND status = 'held'
      GROUP BY current_product_id
    `).all(consumer.id);
    const heldMap = new Map(heldRows.map(r => [r.pid, r.held]));
    for (const [pid, wanted] of refillWanted) {
      const cap = heldMap.get(pid) || 0;
      if (wanted > cap) {
        const product = db.prepare(`SELECT name FROM products WHERE id=?`).get(pid);
        return res.status(400).json({ error: `Cannot refill ${wanted} × ${product.name} — you only hold ${cap} container(s) of this product` });
      }
    }
  }

  const discAmt  = parseFloat((subtotal * discPct / 100).toFixed(2));
  const orderNum = `CORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const order = db.transaction(() => {
    /* Container deposit: charged per unit on Buy-more lines only. Refill
     * lines re-use existing held containers, so no fresh deposit. */
    let containerCostsTotal = 0;
    const resolvedWithContainer = resolved.map(it => {
      const lineContainerCost = it.is_refill
        ? 0
        : parseFloat((it.unit_container_cost * it.quantity).toFixed(2));
      containerCostsTotal += lineContainerCost;
      return { ...it, container_cost: lineContainerCost };
    });
    /* Round the final charge UP to the nearest whole rupee so the consumer is
     * billed an integer amount and our Razorpay invoice line items (clamped to
     * ≥ ₹1.00 each by gateway rules) can sum cleanly to the same total. */
    const grossTotal = Math.ceil(subtotal - discAmt + containerCostsTotal);

    /* Phase 7 — apply store credit if requested. Capped at grossTotal - 1
     * so Razorpay always sees ≥ ₹1 (gateway minimum). The actual ledger
     * debit happens at /payments/verify; here we only reserve the amount
     * by stamping store_credit_applied. */
    let creditApplied = 0;
    const requestedCredit = parseFloat(req.body.store_credit_to_apply || 0);
    if (requestedCredit > 0) {
      const available = storeCredit.getAvailableBalance(consumer.id);
      const usable    = Math.min(requestedCredit, available, Math.max(0, grossTotal - 1));
      creditApplied = parseFloat(usable.toFixed(2));
    }
    const totalAmt = grossTotal - creditApplied;

    const or = db.prepare(`
      INSERT INTO consumer_orders
        (order_number,consumer_id,linked_dealer_id,delivery_dealer_id,is_direct,status,payment_status,
         subtotal,discount_percent,discount_amount,container_costs_total,store_credit_applied,total_amount,pincode,delivery_address,notes,confirmation_sent,
         delivery_latitude,delivery_longitude,delivery_h3_index,delivery_distance_km,assignment_status)
      VALUES (?,?,?,?,?,'pending','pending',?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)
    `).run(orderNum, consumer.id, linkedDealerId, deliveryDealerId, isDirect,
           subtotal, discPct, discAmt, containerCostsTotal, creditApplied, totalAmt, pincode, delivery_address, notes||null,
           hasGeo ? customerLat : null, hasGeo ? customerLng : null,
           deliveryH3Index, deliveryDistanceKm, assignmentStatus);

    const insI = db.prepare(`INSERT INTO consumer_order_items (order_id,product_id,quantity,price,total,container_cost,is_refill) VALUES (?,?,?,?,?,?,?)`);
    for (const it of resolvedWithContainer) {
      insI.run(or.lastInsertRowid, it.product_id, it.quantity, it.price, it.total, it.container_cost, it.is_refill ? 1 : 0);
      db.prepare(`UPDATE products SET stock=stock-? WHERE id=?`).run(it.quantity, it.product_id);
    }

    // Admin-fulfilled orders: warehouse was just debited above, so mark the
    // order as already inventory-deducted. This lets cancel/refund paths
    // restore warehouse stock via returnOrderInventory() without ever having
    // to go through a trader's "processing" step.
    // Check by role so both H3-found admins and fallback-assigned admins are covered.
    if (deliveryDealerId) {
      const fulfiller = db.prepare(`SELECT role FROM users WHERE id = ?`).get(deliveryDealerId);
      if (fulfiller?.role === 'admin') {
        db.prepare(`
          UPDATE consumer_orders
          SET inventory_deducted = 1, fulfilled_by_dealer_id = ?
          WHERE id = ?
        `).run(deliveryDealerId, or.lastInsertRowid);
      }
    }

    /* Commissions are recorded after payment confirmation, not here */

    /* Optionally save new address to profile */
    if (!address_id && save_address) {
      const hasAddresses = db.prepare(`SELECT COUNT(*) as c FROM consumer_addresses WHERE consumer_id=?`).get(consumer.id).c;
      const shouldBeDefault = make_default_address || hasAddresses === 0 ? 1 : 0;
      if (shouldBeDefault) {
        db.prepare(`UPDATE consumer_addresses SET is_default=0 WHERE consumer_id=?`).run(consumer.id);
      }
      // Include geocoded lat/lng/h3 if available from order processing
      const addrH3 = hasGeo ? latLngToH3Index(customerLat, customerLng) : null;
      db.prepare(`INSERT INTO consumer_addresses (consumer_id,label,name,phone,address,pincode,is_default,latitude,longitude,h3_index) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(consumer.id, address_label || 'Home', delivery_name || consumer.name, delivery_phone || consumer.phone || '', delivery_address, pincode, shouldBeDefault,
             hasGeo ? customerLat : null, hasGeo ? customerLng : null, addrH3);
    }

    return db.prepare(`SELECT * FROM consumer_orders WHERE id=?`).get(or.lastInsertRowid);
  })();

  /* Notifications and real-time updates fire after payment is confirmed,
     not here — so dealers don't see orders before the consumer has paid. */

  /* Build confirmation response */
  let parentDealer = null;
  if (!isDirect) {
    const dealer = db.prepare(`SELECT * FROM users WHERE id=?`).get(linkedDealerId);
    parentDealer = dealer?.tier === 2 && dealer.referred_by_id
      ? db.prepare(`SELECT name,phone FROM users WHERE id=?`).get(dealer.referred_by_id)
      : dealer;
  }

  const deliveryInfo = deliveryDealerId
    ? db.prepare(`SELECT name,phone FROM users WHERE id=?`).get(deliveryDealerId)
    : null;

  const confirmationMsg = isDirect
    ? (deliveryInfo
        ? `Order placed! ${deliveryInfo.name} (${deliveryInfo.phone}) will deliver your order.`
        : 'Order placed! Our team will contact you shortly to confirm delivery details.')
    : `Order confirmed! Your dealer ${parentDealer?.name} (${parentDealer?.phone}) will coordinate your delivery.`;

  res.status(201).json({
    order,
    discount: { percent: discPct, amount: discAmt },
    delivery: {
      dealerId:    deliveryDealerId,
      dealerName:  deliveryInfo?.name  ?? null,
      dealerPhone: deliveryInfo?.phone ?? null,
      distanceKm:  deliveryDistanceKm,
      h3Index:     deliveryH3Index,
      method:      hasGeo && deliveryDistanceKm !== null ? 'h3_spatial' : 'referral_chain',
    },
    confirmation: {
      orderNumber: order.order_number,
      isDirect: Boolean(isDirect),
      parentDealerName:  parentDealer?.name  ?? 'Admin',
      parentDealerPhone: parentDealer?.phone ?? 'admin@tradehub.com',
      message: confirmationMsg,
    },
  });

});

/* ── Auth: Product IDs with active/paid orders (for container cost display) */
router.get('/ordered-product-ids', authConsumer, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT coi.product_id
    FROM consumer_order_items coi
    JOIN consumer_orders co ON coi.order_id = co.id
    WHERE co.consumer_id = ? AND co.payment_status IN ('paid', 'pending')
  `).all(req.consumer.id);
  res.json({ product_ids: rows.map(r => r.product_id) });
});

/* ── Auth: My Orders ──────────────────────────────────────────────────── */
router.get('/orders', authConsumer, (req, res) => {
  const orders = db.prepare(`
    SELECT co.*, u.name as dealer_name, u.phone as dealer_phone, u.tier as dealer_tier,
           d2.name as delivery_dealer_name, d2.phone as delivery_dealer_phone
    FROM consumer_orders co
    LEFT JOIN users u  ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    WHERE co.consumer_id = ? AND co.payment_status != 'pending'
    ORDER BY co.created_at DESC
  `).all(req.consumer.id);

  /* Attach item_count + items with product details for each order */
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
    // OTP is managed by Twilio Verify — not stored or exposed here
    delete o.delivery_otp_plain;
  }

  res.json({ orders });
});

router.get('/orders/:id', authConsumer, (req, res) => {
  const order = db.prepare(`
    SELECT co.*, c.name as consumer_name, c.phone as consumer_phone,
           u.name as dealer_name, u.phone as dealer_phone, u.tier as dealer_tier,
           d2.name as delivery_dealer_name, d2.phone as delivery_dealer_phone,
           p.name as parent_dealer_name, p.phone as parent_dealer_phone
    FROM consumer_orders co
    JOIN consumers c  ON co.consumer_id = c.id
    LEFT JOIN users u  ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    LEFT JOIN users p  ON (u.tier=2 AND u.referred_by_id=p.id)
    WHERE co.id=? AND co.consumer_id=?
  `).get(req.params.id, req.consumer.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare(`SELECT oi.*, p.name as product_name, p.sku, p.image_url, p.unit FROM consumer_order_items oi JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?`).all(order.id);
  res.json({ order, items });
});

/* ── DELETE /orders/:id — cancel an unpaid pending order ─────────────── */
router.delete('/orders/:id', authConsumer, (req, res) => {
  const order = db.prepare(
    `SELECT * FROM consumer_orders WHERE id=? AND consumer_id=?`
  ).get(req.params.id, req.consumer.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment_status !== 'pending')
    return res.status(400).json({ error: 'Only unpaid pending orders can be cancelled' });

  db.transaction(() => {
    /* Restore stock for each item */
    const items = db.prepare(`SELECT * FROM consumer_order_items WHERE order_id=?`).all(order.id);
    for (const item of items) {
      db.prepare(`UPDATE products SET stock=stock+? WHERE id=?`).run(item.quantity, item.product_id);
    }
    db.prepare(`DELETE FROM consumer_order_items WHERE order_id=?`).run(order.id);
    db.prepare(`DELETE FROM consumer_orders WHERE id=?`).run(order.id);
  })();

  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════════════
 * REVIEWS
 * ══════════════════════════════════════════════════════════════════════ */

/* GET /consumer/products/:id/reviews — public */
router.get('/products/:id/reviews', (req, res) => {
  const reviews = db.prepare(`
    SELECT id, consumer_name, rating, body, images, verified_buyer, created_at
    FROM product_reviews
    WHERE product_id = ?
    ORDER BY verified_buyer DESC, created_at DESC
  `).all(req.params.id);
  const avg = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  res.json({ reviews, average_rating: avg ? parseFloat(avg) : null, count: reviews.length });
});

/* POST /consumer/products/:id/reviews — requires consumer auth or review token */
router.post('/products/:id/reviews', async (req, res) => {
  const { rating, body: reviewBody, images, token } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1–5' });

  let consumer = null;
  let verifiedBuyer = false;

  if (token) {
    // Token-based auth (from email link)
    const row = db.prepare(`
      SELECT rt.*, c.id as cid, c.name as cname
      FROM review_tokens rt JOIN consumers c ON c.id = rt.consumer_id
      WHERE rt.token = ? AND rt.product_id = ? AND rt.used = 0
        AND rt.expires_at > datetime('now')
    `).get(token, req.params.id);
    if (!row) return res.status(401).json({ error: 'Invalid or expired review link' });
    consumer = { id: row.cid, name: row.cname };
    verifiedBuyer = true;
    db.prepare('UPDATE review_tokens SET used = 1 WHERE token = ?').run(token);
  } else {
    // Consumer JWT auth
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    try {
      const decoded = require('jsonwebtoken').verify(header.split(' ')[1], process.env.JWT_SECRET);
      if (decoded.role !== 'consumer') return res.status(403).json({ error: 'Consumer access only' });
      consumer = db.prepare('SELECT id, name FROM consumers WHERE id=? AND status=?').get(decoded.id, 'active');
      if (!consumer) return res.status(401).json({ error: 'Consumer not found' });
      // Check verified buyer
      const bought = db.prepare(`
        SELECT 1 FROM consumer_order_items oi
        JOIN consumer_orders co ON co.id = oi.order_id
        WHERE co.consumer_id = ? AND oi.product_id = ? AND co.status = 'delivered'
        LIMIT 1
      `).get(consumer.id, req.params.id);
      verifiedBuyer = !!bought;
    } catch { return res.status(401).json({ error: 'Invalid token' }); }
  }

  if (!verifiedBuyer) return res.status(403).json({ error: 'You can only review products you have purchased and received' });

  try {
    db.prepare(`
      INSERT INTO product_reviews (product_id, consumer_id, consumer_name, rating, body, images, verified_buyer)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(product_id, consumer_id) DO UPDATE SET
        rating = excluded.rating, body = excluded.body,
        images = excluded.images, created_at = CURRENT_TIMESTAMP
    `).run(req.params.id, consumer.id, consumer.name, rating, reviewBody || null, images ? JSON.stringify(images) : null);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /consumer/products/:id/reviews error:', err);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

/* GET /consumer/review/validate?token=xxx&pid=xxx — validate token, return product+consumer info */
router.get('/review/validate', (req, res) => {
  const { token, pid } = req.query;
  if (!token || !pid) return res.status(400).json({ error: 'token and pid required' });
  const row = db.prepare(`
    SELECT rt.consumer_id, rt.product_id, rt.used,
           c.name as consumer_name, c.email as consumer_email,
           p.name as product_name, p.image_url, p.category
    FROM review_tokens rt
    JOIN consumers c ON c.id = rt.consumer_id
    JOIN products p ON p.id = rt.product_id
    WHERE rt.token = ? AND rt.product_id = ? AND rt.expires_at > datetime('now')
  `).get(token, pid);
  if (!row) return res.status(404).json({ error: 'Invalid or expired review link' });
  res.json({
    valid: !row.used,
    already_reviewed: !!row.used,
    consumer_name: row.consumer_name,
    product: { id: row.product_id, name: row.product_name, image_url: row.image_url, category: row.category },
  });
});

/* GET /consumer/review/check?pid=xxx — check if logged-in consumer can review (has purchased) */
router.get('/review/check', authConsumer, (req, res) => {
  const { pid } = req.query;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  const bought = db.prepare(`
    SELECT 1 FROM consumer_order_items oi
    JOIN consumer_orders co ON co.id = oi.order_id
    WHERE co.consumer_id = ? AND oi.product_id = ? AND co.status = 'delivered'
    LIMIT 1
  `).get(req.consumer.id, pid);
  const existing = db.prepare('SELECT id FROM product_reviews WHERE product_id=? AND consumer_id=?').get(pid, req.consumer.id);
  res.json({ can_review: !!bought, already_reviewed: !!existing });
});

module.exports = router;
