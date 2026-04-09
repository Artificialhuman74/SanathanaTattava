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
} = require('../services/notificationService');
const { emitOrderUpdate } = require('../websocket/socketServer');

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

/* ── Auth: Consumer Me ────────────────────────────────────────────────── */
router.get('/me', authConsumer, (req, res) => {
  const consumer = { ...req.consumer };
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
  params.push(new Date().toISOString(), req.consumer.id);
  db.prepare(`UPDATE consumers SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM consumers WHERE id = ?').get(req.consumer.id);
  res.json({ consumer: updated });
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
  db.prepare('UPDATE consumers SET password = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), req.consumer.id);
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

  /* Determine linked dealer (consumer's own or from checkout code) */
  let linkedDealerId = consumer.linked_dealer_id ?? null;
  if (!linkedDealerId && referral_code && referral_code.trim()) {
    const dealer = db.prepare(`SELECT id FROM users WHERE referral_code=? AND role='trader' AND status='active'`).get(referral_code.trim());
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
    if (dealer?.delivery_enabled && dealer?.will_deliver) {
      deliveryDealerId = dealer.id;
    } else if (dealer?.tier === 2 && dealer.referred_by_id) {
      const parent = db.prepare(`SELECT * FROM users WHERE id=?`).get(dealer.referred_by_id);
      if (parent?.delivery_enabled && parent?.will_deliver) deliveryDealerId = parent.id;
    }
  }
  // Direct orders with no geo: admin handles delivery (deliveryDealerId stays null)

  const assignmentStatus = deliveryDealerId ? 'assigned' : 'unassigned';

  /* Validate items */
  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = db.prepare(`SELECT * FROM products WHERE id=? AND status='active'`).get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product #${item.product_id} not found` });
    if (product.stock < item.quantity) return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
    const total = product.price * item.quantity;
    subtotal += total;
    resolved.push({ ...item, price: product.price, total, name: product.name });
  }

  const discAmt  = parseFloat((subtotal * discPct / 100).toFixed(2));
  const totalAmt = parseFloat((subtotal - discAmt).toFixed(2));
  const orderNum = `CORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const order = db.transaction(() => {
    const or = db.prepare(`
      INSERT INTO consumer_orders
        (order_number,consumer_id,linked_dealer_id,delivery_dealer_id,is_direct,status,payment_status,
         subtotal,discount_percent,discount_amount,total_amount,pincode,delivery_address,notes,confirmation_sent,
         delivery_latitude,delivery_longitude,delivery_h3_index,delivery_distance_km,assignment_status)
      VALUES (?,?,?,?,?,'pending','pending',?,?,?,?,?,?,?,1,?,?,?,?,?)
    `).run(orderNum, consumer.id, linkedDealerId, deliveryDealerId, isDirect,
           subtotal, discPct, discAmt, totalAmt, pincode, delivery_address, notes||null,
           hasGeo ? customerLat : null, hasGeo ? customerLng : null,
           deliveryH3Index, deliveryDistanceKm, assignmentStatus);

    const insI = db.prepare(`INSERT INTO consumer_order_items (order_id,product_id,quantity,price,total) VALUES (?,?,?,?,?)`);
    for (const it of resolved) {
      insI.run(or.lastInsertRowid, it.product_id, it.quantity, it.price, it.total);
      db.prepare(`UPDATE products SET stock=stock-? WHERE id=?`).run(it.quantity, it.product_id);
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

  /* ── Notifications ──────────────────────────────────────────────── */
  if (deliveryDealerId) {
    try {
      const deliveryDealer = db.prepare(`SELECT id,name,phone FROM users WHERE id=?`).get(deliveryDealerId);
      if (deliveryDealer) {
        // Notify the delivery dealer about the new assignment
        notifyDealerDeliveryAssigned({
          dealerId:        deliveryDealer.id,
          dealerName:      deliveryDealer.name,
          orderNumber:     order.order_number,
          consumerName:    consumer.name,
          deliveryAddress: delivery_address,
          distanceKm:      deliveryDistanceKm ?? 0,
        });
        // Notify the consumer about who will deliver
        notifyConsumerDeliveryAssigned({
          consumerId:  consumer.id,
          orderNumber: order.order_number,
          dealerName:  deliveryDealer.name,
          dealerPhone: deliveryDealer.phone,
        });
        // If the delivery dealer is DIFFERENT from the linked dealer,
        // notify the linked dealer that the order was routed to the nearest dealer
        if (linkedDealerId && deliveryDealerId !== linkedDealerId) {
          const linkedDealer = db.prepare(`SELECT id,name FROM users WHERE id=?`).get(linkedDealerId);
          if (linkedDealer) {
            notifyLinkedDealerOrderRouted({
              linkedDealerId:     linkedDealer.id,
              linkedDealerName:   linkedDealer.name,
              orderNumber:        order.order_number,
              consumerName:       consumer.name,
              deliveryDealerId:   deliveryDealer.id,
              deliveryDealerName: deliveryDealer.name,
              distanceKm:         deliveryDistanceKm ?? 0,
            });
          }
        }
      }
    } catch (notifErr) {
      console.error('[notification] failed:', notifErr.message);
      // non-fatal — order still succeeds
    }
  }

  /* ── Real-time: push new order to all relevant traders + admin ───── */
  emitOrderUpdate({
    orderId:         order.id,
    orderNumber:     order.order_number,
    status:          order.status,
    deliveryStatus:  order.delivery_status || null,
    consumerId:      consumer.id,
    linkedDealerId:  linkedDealerId,
    deliveryDealerId: deliveryDealerId,
    extra: { event: 'order_assigned' },
  });

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

/* ── Auth: My Orders ──────────────────────────────────────────────────── */
router.get('/orders', authConsumer, (req, res) => {
  const orders = db.prepare(`
    SELECT co.*, u.name as dealer_name, u.phone as dealer_phone, u.tier as dealer_tier,
           d2.name as delivery_dealer_name, d2.phone as delivery_dealer_phone
    FROM consumer_orders co
    LEFT JOIN users u  ON co.linked_dealer_id = u.id
    LEFT JOIN users d2 ON co.delivery_dealer_id = d2.id
    WHERE co.consumer_id = ?
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

module.exports = router;
