/**
 * ST Partner app: a delivery partner's own status (traders and approved riders).
 *
 *   GET    /api/partner/home              Home screen: online state, start places, today's numbers
 *   PUT    /api/partner/online            { online, place_id? | lat,lng }  go online / offline
 *   POST   /api/partner/location          { lat, lng, accuracy? }  live position while online
 *   GET    /api/partner/places            saved start places
 *   POST   /api/partner/places            { label, address, lat, lng, is_default? }
 *   PUT    /api/partner/places/:id        same fields
 *   POST   /api/partner/places/:id/default
 *   DELETE /api/partner/places/:id        (not the last one)
 *   POST   /api/partner/test-alert        rings this partner's own phones (checks the alert setup)
 *   GET    /api/partner/earnings          last 7 days, per day, and what has been paid out
 *   GET    /api/partner/payout            bank details (masked), payout account steps, recent payouts
 *   GET    /api/partner/hours             trader delivery hours, 7 days (defaults until saved)
 *   PUT    /api/partner/hours             { days: [{ enabled, start, end } × 7] }  minutes from midnight
 *   PUT    /api/partner/rider-jobs        { on }  trader opts in to other shops' rider jobs
 *   PUT    /api/partner/profile           { name, phone }
 *
 * "Online" is one state shared with the website: the app's switch also sets
 * availability_status and will_deliver (services/presence.js), so going Online means
 * "I'll deliver" to both the dispatch engine and the website.
 */
const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { latLngToH3Index } = require('../services/h3Service');
const { sendDataToUser } = require('../services/pushService');
const hours = require('../services/deliveryHours');
const { setOnline } = require('../services/presence');

const router = express.Router();

/* Traders, admins, and riders an admin has approved. Pending riders only see their application. */
const requireDeliveryPartner = (req, res, next) => {
  const { role, review_status: review } = req.user;
  if (role === 'trader' || role === 'admin' || (role === 'rider' && review === 'approved')) return next();
  if (role === 'rider') return res.status(403).json({ error: 'Your profile is still being checked' });
  return res.status(403).json({ error: 'Delivery partner access required' });
};

router.use(authenticate, requireDeliveryPartner);

const LABELS = ['home', 'shop', 'other'];

const validCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function h3Of(lat, lng) {
  try { return latLngToH3Index(lat, lng); } catch (_) { return null; }
}

/** A trader's shop becomes their first start place the first time they open the app. */
function ensurePlaces(user) {
  const places = db.prepare('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id').all(user.id);
  if (places.length || !validCoord(user.latitude, user.longitude)) return places;
  db.prepare(`
    INSERT INTO user_addresses (user_id, label, address, latitude, longitude, h3_index, is_default)
    VALUES (?, 'shop', ?, ?, ?, ?, 1)
  `).run(user.id, user.address || 'My shop', user.latitude, user.longitude, user.h3_index || h3Of(user.latitude, user.longitude));
  return db.prepare('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id').all(user.id);
}

const placeView = (p) => ({
  id: p.id, label: p.label, address: p.address,
  latitude: p.latitude, longitude: p.longitude, is_default: !!p.is_default,
});

/* Flat rider fee per delivery (admin setting, handoff §4.11). Placeholder default until the owner sets it. */
function riderFee() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'rider_fee_per_delivery'`).get();
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 0 ? n : 45;
}

function todayNumbers(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const deliveries = db.prepare(`
    SELECT COUNT(*) AS n FROM consumer_orders
    WHERE (delivery_dealer_id = ? OR rider_id = ?) AND delivery_status = 'delivered' AND delivery_verified_at >= ?
  `).get(userId, userId, since).n;
  const earned = db.prepare(`
    SELECT COALESCE(SUM(c.amount), 0) AS total
    FROM commissions c JOIN consumer_orders o ON o.id = c.consumer_order_id
    WHERE c.trader_id = ? AND (o.delivery_dealer_id = ? OR o.rider_id = ?) AND o.delivery_status = 'delivered'
      AND o.delivery_verified_at >= ? AND c.status != 'cancelled'
  `).get(userId, userId, userId, since).total;
  return { deliveries, earned: Math.round(earned * 100) / 100 };
}

router.get('/home', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const places = ensurePlaces(user);
  const current = user.online_place_id ? places.find((p) => p.id === user.online_place_id) : null;
  res.json({
    online: !!user.partner_online,
    online_since: user.online_since,
    // Where they last went online from: a saved place, or "where I am" (live).
    started_from: user.partner_online || user.online_since
      ? (current ? { kind: 'place', place: placeView(current) } : { kind: 'live' })
      : null,
    places: places.map(placeView),
    // Last position the phone reported (the "near you" map centres on it).
    live: user.live_lat != null && user.live_lng != null ? { lat: user.live_lat, lng: user.live_lng, at: user.live_at } : null,
    today: todayNumbers(user.id),
    missed_offer_streak: user.missed_offer_streak || 0,
    auto_offline_at: user.auto_offline_at,
    takes_rider_jobs: !!user.takes_rider_jobs,
    rider_fee: riderFee(),
  });
});

router.put('/online', (req, res) => {
  const online = req.body?.online === true;
  if (!online) {
    setOnline(req.user.id, false);
    return res.json({ online: false });
  }
  let placeId = null;
  let lat = Number(req.body.lat);
  let lng = Number(req.body.lng);
  if (req.body.place_id != null) {
    const place = db.prepare('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?').get(req.body.place_id, req.user.id);
    if (!place) return res.status(404).json({ error: 'That place is not saved on your account' });
    placeId = place.id;
    if (!validCoord(lat, lng)) { lat = place.latitude; lng = place.longitude; }
  } else if (!validCoord(lat, lng)) {
    return res.status(400).json({ error: 'Pick a start place or share your location' });
  }
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET online_since = CURRENT_TIMESTAMP, online_place_id = ?,
        live_lat = ?, live_lng = ?, live_at = CURRENT_TIMESTAMP,
        missed_offer_streak = 0, auto_offline_at = NULL
      WHERE id = ?
    `).run(placeId, lat, lng, req.user.id);
    setOnline(req.user.id, true);
  })();
  res.json({ online: true, place_id: placeId });
});

router.post('/location', (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!validCoord(lat, lng)) return res.status(400).json({ error: 'Invalid location' });
  const result = db.prepare(`
    UPDATE users SET live_lat = ?, live_lng = ?, live_at = CURRENT_TIMESTAMP
    WHERE id = ? AND partner_online = 1
  `).run(lat, lng, req.user.id);
  // 409 tells the app it was set offline elsewhere (admin, auto-offline) so it can stop sharing.
  if (result.changes === 0) return res.status(409).json({ error: 'You are offline', online: false });
  res.json({ ok: true });
});

/* ── Start places ─────────────────────────────────────────────────────── */

function readPlace(body) {
  const label = LABELS.includes(String(body?.label || '').toLowerCase()) ? String(body.label).toLowerCase() : 'other';
  const address = String(body?.address || '').trim();
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!address) return { error: 'Add the address of this place' };
  if (!validCoord(lat, lng)) return { error: 'Set the pin on the map' };
  return { label, address, lat, lng };
}

function makeDefault(userId, placeId) {
  db.transaction(() => {
    db.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').run(userId);
    db.prepare('UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?').run(placeId, userId);
    const p = db.prepare('SELECT * FROM user_addresses WHERE id = ?').get(placeId);
    // Riders' default place doubles as their profile location; traders keep their shop address.
    if (p && db.prepare(`SELECT role FROM users WHERE id = ?`).get(userId).role === 'rider') {
      db.prepare('UPDATE users SET address = ?, latitude = ?, longitude = ?, h3_index = ? WHERE id = ?')
        .run(p.address, p.latitude, p.longitude, p.h3_index, userId);
    }
  })();
}

router.get('/places', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ places: ensurePlaces(user).map(placeView) });
});

router.post('/places', (req, res) => {
  const p = readPlace(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const count = db.prepare('SELECT COUNT(*) AS n FROM user_addresses WHERE user_id = ?').get(req.user.id).n;
  if (count >= 5) return res.status(400).json({ error: 'You can save up to 5 places' });
  const id = db.prepare(`
    INSERT INTO user_addresses (user_id, label, address, latitude, longitude, h3_index, is_default)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(req.user.id, p.label, p.address, p.lat, p.lng, h3Of(p.lat, p.lng)).lastInsertRowid;
  if (req.body.is_default || count === 0) makeDefault(req.user.id, id);
  res.status(201).json({ place: placeView(db.prepare('SELECT * FROM user_addresses WHERE id = ?').get(id)) });
});

router.put('/places/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Place not found' });
  const p = readPlace(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  db.prepare('UPDATE user_addresses SET label = ?, address = ?, latitude = ?, longitude = ?, h3_index = ? WHERE id = ?')
    .run(p.label, p.address, p.lat, p.lng, h3Of(p.lat, p.lng), existing.id);
  if (req.body.is_default || existing.is_default) makeDefault(req.user.id, existing.id);
  res.json({ place: placeView(db.prepare('SELECT * FROM user_addresses WHERE id = ?').get(existing.id)) });
});

router.post('/places/:id/default', (req, res) => {
  const existing = db.prepare('SELECT id FROM user_addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Place not found' });
  makeDefault(req.user.id, existing.id);
  res.json({ ok: true });
});

router.delete('/places/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Place not found' });
  const count = db.prepare('SELECT COUNT(*) AS n FROM user_addresses WHERE user_id = ?').get(req.user.id).n;
  if (count <= 1) return res.status(400).json({ error: 'Keep at least one start place' });
  db.prepare('DELETE FROM user_addresses WHERE id = ?').run(existing.id);
  if (existing.is_default) {
    const next = db.prepare('SELECT id FROM user_addresses WHERE user_id = ? ORDER BY id LIMIT 1').get(req.user.id);
    makeDefault(req.user.id, next.id);
  }
  res.json({ ok: true });
});

/* ── Alert check ──────────────────────────────────────────────────────── */

/* Sends a sample order alert to this partner's own phones, so they (and we) can confirm
 * the full-screen ring works on their phone before real orders depend on it. */
router.post('/test-alert', async (req, res) => {
  const result = await sendDataToUser(req.user.id, {
    type: 'order_offer',
    test: '1',
    offer_id: `test-${Date.now()}`,
    role: req.user.role === 'rider' ? 'rider' : 'trader',
  });
  if (result.sent === 0 && result.failed === 0) {
    return res.status(409).json({ error: 'This phone isn’t registered for alerts yet. Allow notifications and try again.', ...result });
  }
  if (result.sent === 0) {
    return res.status(503).json({ error: 'Couldn’t reach the alert service just now. Try again in a minute.', ...result });
  }
  res.json(result);
});

/* ── Earnings and payouts ──────────────────────────────────────────────── */

const IST = `'+330 minutes'`;
const money = (n) => Math.round((n || 0) * 100) / 100;

/* What this partner earned per local day: commissions (traders) and delivery fees (riders),
 * dated by when the order was delivered (or when the commission was made, for orders
 * someone else delivered). */
router.get('/earnings', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 31);
  const today = db.prepare(`SELECT date('now', ${IST}) AS d`).get().d;
  const from = db.prepare(`SELECT date(?, ?) AS d`).get(today, `-${days - 1} days`).d;
  const id = req.user.id;
  const earnedRows = db.prepare(`
    SELECT date(COALESCE(o.delivery_verified_at, c.created_at), ${IST}) AS day,
           SUM(c.amount) AS amount,
           SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END) AS paid
    FROM commissions c LEFT JOIN consumer_orders o ON o.id = c.consumer_order_id
    WHERE c.trader_id = ? AND c.status != 'cancelled'
      AND date(COALESCE(o.delivery_verified_at, c.created_at), ${IST}) BETWEEN ? AND ?
    GROUP BY day
  `).all(id, from, today);
  const deliveryRows = db.prepare(`
    SELECT date(delivery_verified_at, ${IST}) AS day, COUNT(*) AS n
    FROM consumer_orders
    WHERE (delivery_dealer_id = ? OR rider_id = ?) AND delivery_status = 'delivered'
      AND date(delivery_verified_at, ${IST}) BETWEEN ? AND ?
    GROUP BY day
  `).all(id, id, from, today);
  const list = [];
  for (let i = 0; i < days; i++) {
    const day = db.prepare(`SELECT date(?, ?) AS d`).get(from, `+${i} days`).d;
    const e = earnedRows.find((r) => r.day === day);
    const d = deliveryRows.find((r) => r.day === day);
    list.push({ date: day, deliveries: d?.n || 0, amount: money(e?.amount) });
  }
  const total = money(list.reduce((a, d) => a + d.amount, 0));
  const paid = money(earnedRows.reduce((a, r) => a + (r.paid || 0), 0));
  const user = db.prepare('SELECT bank_account_number, bank_ifsc FROM users WHERE id = ?').get(id);
  res.json({
    from, to: today, days: list, total,
    deliveries: list.reduce((a, d) => a + d.deliveries, 0),
    paid, pending: money(total - paid),
    bank: user.bank_account_number ? { ifsc: user.bank_ifsc, last4: String(user.bank_account_number).slice(-4) } : null,
  });
});

const PAYOUT_STEPS = ['created', 'bank_added', 'stakeholder_added', 'activated'];

router.get('/payout', (req, res) => {
  const u = db.prepare(`
    SELECT name, bank_account_name, bank_account_number, bank_ifsc, pan, pan_verified,
           razorpay_linked_account_id, razorpay_account_status
    FROM users WHERE id = ?
  `).get(req.user.id);
  const status = u.razorpay_account_status || null;
  // How far the Razorpay Route account got: 0 none … 4 active (needs_clarification / under_review sit at "Checked").
  const step = status === 'activated' ? 4
    : ['stakeholder_added', 'under_review', 'needs_clarification'].includes(status) ? 3
    : Math.max(0, PAYOUT_STEPS.indexOf(status) + 1);
  const recent = db.prepare(`
    SELECT date(COALESCE(c.paid_at, c.created_at), ${IST}) AS day,
           SUM(c.amount) AS amount,
           MIN(CASE WHEN c.status = 'paid' THEN 1 ELSE 0 END) AS all_paid
    FROM commissions c
    WHERE c.trader_id = ? AND c.status != 'cancelled'
    GROUP BY day ORDER BY day DESC LIMIT 10
  `).all(req.user.id);
  const pan = u.pan ? String(u.pan).toUpperCase() : null;
  res.json({
    holder: u.bank_account_name || u.name,
    ifsc: u.bank_ifsc || null,
    last4: u.bank_account_number ? String(u.bank_account_number).slice(-4) : null,
    pan_masked: pan && pan.length === 10 ? `${pan.slice(0, 5)}••••${pan.slice(9)}` : null,
    pan_verified: !!u.pan_verified,
    account_status: status,
    step,
    needs_clarification: status === 'needs_clarification',
    recent: recent.map((r) => ({ date: r.day, amount: money(r.amount), status: r.all_paid ? 'sent' : 'on_the_way' })),
  });
});

/* ── Delivery hours (traders) ─────────────────────────────────────────── */

const traderOnly = (req, res, next) => (req.user.role === 'rider'
  ? res.status(403).json({ error: 'Delivery hours are for shops' })
  : next());

router.get('/hours', traderOnly, (req, res) => {
  res.json(hours.getHours(req.user.id));
});

router.put('/hours', traderOnly, (req, res) => {
  const error = hours.setHours(req.user.id, req.body?.days, req.user.id);
  if (error) return res.status(400).json({ error });
  res.json(hours.getHours(req.user.id));
});

/* ── Rider jobs opt-in (traders) ──────────────────────────────────────── */

router.put('/rider-jobs', traderOnly, (req, res) => {
  const on = req.body?.on === true;
  db.prepare('UPDATE users SET takes_rider_jobs = ? WHERE id = ?').run(on ? 1 : 0, req.user.id);
  res.json({ takes_rider_jobs: on });
});

/* ── Profile ──────────────────────────────────────────────────────────── */

router.put('/profile', (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  const phone = String(req.body?.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const fields = {};
  if (name.length < 2 || name.length > 60) fields.name = 'Enter your full name';
  if (!/^[6-9]\d{9}$/.test(phone)) fields.phone = 'Enter a 10-digit mobile number';
  if (Object.keys(fields).length) return res.status(400).json({ error: Object.values(fields)[0], fields });
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  res.json({ name, phone });
});

module.exports = router;
