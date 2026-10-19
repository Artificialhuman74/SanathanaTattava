/**
 * ST Partner app: offers and the delivery itself (handoff §4.7).
 *
 *   GET  /api/partner/orders/active           what this partner is working on now
 *   GET  /api/partner/orders/offers/:id       the ringing offer's card
 *   POST /api/partner/orders/offers/:id/accept
 *   POST /api/partner/orders/offers/:id/decline   trader "I can't deliver" / rider "Skip"
 *   GET  /api/partner/orders/:id              order screen (role-aware: self, packer, rider)
 *   POST /api/partner/orders/:id/packed       shop packed it (stock leaves the shop, as today)
 *   POST /api/partner/orders/:id/start        trader delivering themselves: on the way (customer gets the code)
 *   POST /api/partner/orders/:id/handover     { code }  shop types the rider's pickup code
 *   POST /api/partner/orders/:id/check-code   { otp }  is this the customer's code? (before the door photo)
 *   POST /api/partner/orders/:id/resend-code  sends the customer their code again
 *   POST /api/partner/orders/:id/deliver      multipart { otp, photo }  customer's code + photo at the door
 *   POST /api/partner/orders/:id/fail         { reason }  couldn't deliver
 *   POST /api/partner/orders/:id/returned     { code }  shop types the rider's return code
 *   GET  /api/partner/orders/:id/customer-phone   only while delivering (Call button; never shown)
 *   GET  /api/partner/orders/:id/rider-photo      rider's selfie (small) for the shop at pickup
 *
 * The website's /api/delivery routes keep working for traders; both write the same columns.
 */
const express = require('express');
const fs = require('fs');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { uploadProof } = require('../middleware/uploadProof');
const { deductOrderInventory } = require('../services/inventoryService');
const { markHoldingsDelivered } = require('../services/containerHoldingsService');
const { syncAdminDeliveryCommission } = require('../services/commissionRoutingService');
const { sendDeliveryOtpEmail, sendOutForDeliveryEmail } = require('../services/emailService');
const { createNotification } = require('../services/notificationService');
const { sendToUser } = require('../services/pushService');
const { emitOrderUpdate } = require('../websocket/socketServer');
const hours = require('../services/deliveryHours');
const dispatch = require('../services/dispatch');
const { kycFilePath } = require('../services/kycStorage');

const router = express.Router();

router.use(authenticate, (req, res, next) => {
  const { role, review_status: review } = req.user;
  if (role === 'trader' || role === 'admin' || (role === 'rider' && review === 'approved')) return next();
  return res.status(403).json({ error: 'Delivery partner access required' });
});

const now = () => Date.now();
const nowIso = () => new Date().toISOString();
const ACTIVE_STAGES = ['trader_offer', 'trader_accepted', 'rider_search', 'rider_assigned', 'picked_up', 'returning'];

function getOrder(id) {
  return db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(id);
}

/** How this user relates to the order: self (trader delivering), packer (shop, rider delivering), rider. */
function roleIn(order, userId) {
  if (order.rider_id === userId) return 'rider';
  if (order.delivery_dealer_id === userId) {
    return ['rider_search', 'rider_assigned', 'picked_up', 'returning'].includes(order.dispatch_stage) ? 'packer' : 'self';
  }
  return null;
}

function emit(order) {
  try {
    const o = getOrder(order.id);
    emitOrderUpdate({
      orderId: o.id, orderNumber: o.order_number, status: o.status, deliveryStatus: o.delivery_status,
      consumerId: o.consumer_id, linkedDealerId: o.linked_dealer_id, deliveryDealerId: o.delivery_dealer_id,
      extra: { dispatchStage: o.dispatch_stage, riderId: o.rider_id },
    });
  } catch (_) { /* best-effort */ }
}

function notifyConsumer(order, title, body, data = {}) {
  try {
    createNotification('consumer', order.consumer_id, title, body, { orderNumber: order.order_number, ...data });
  } catch (err) {
    console.error('[partner-orders] consumer notification failed:', err.message);
  }
}

function pushTo(userId, title, body, data) {
  if (!userId) return;
  sendToUser(userId, { title, body, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), channelId: 'orders_info' }).catch(() => {});
}

const fail = (res, status, error) => res.status(status).json({ error });

/** Loads the order and checks the caller's role; sends the error itself when not allowed. */
function load(req, res, roles) {
  const order = getOrder(req.params.id);
  if (!order) { fail(res, 404, 'Order not found'); return null; }
  const role = roleIn(order, req.user.id);
  if (!role || (roles && !roles.includes(role))) { fail(res, 403, 'This order isn’t yours'); return null; }
  return { order, role };
}

/* ── Views ─────────────────────────────────────────────────────────────── */

function detail(order, userId) {
  const role = roleIn(order, userId);
  const card = dispatch.orderCard(order, userId, role === 'rider' ? 'rider' : 'trader');
  const shop = dispatch.shopOf(order);
  const accepted = !['trader_offer', 'awaiting_hours'].includes(order.dispatch_stage);
  const out = {
    ...card,
    role,
    stage: order.dispatch_stage,
    delivery_status: order.delivery_status,
    packed: !!order.delivery_packed_at && ['packed', 'out_for_delivery', 'delivered'].includes(order.delivery_status)
      || (order.delivery_status === 'failed' && !!order.delivery_packed_at),
    attempt: order.attempt_count || 0,
    fail_reason: order.delivery_failed_reason || null,
  };
  // The full address only after someone has taken the order (handoff §4.8).
  if (accepted && role !== 'packer') {
    out.customer = {
      ...out.customer,
      address: order.delivery_address,
      lat: order.delivery_latitude,
      lng: order.delivery_longitude,
      can_call: order.delivery_status === 'out_for_delivery',
    };
  }
  if (shop) {
    out.shop = { ...out.shop, address: shop.address, lat: shop.latitude, lng: shop.longitude, phone: role === 'rider' ? shop.phone : undefined };
  }
  if (role === 'packer') {
    // What the shop keeps on a rider-delivered order (their usual commission × the admin's share %).
    out.share_amount = Math.round(card.earn * dispatch.traderShare()) / 100;
  }
  if (order.rider_id && role !== 'rider') {
    const r = db.prepare('SELECT id, name, phone, vehicle_type, vehicle_plate, live_lat, live_lng, live_at, kyc_selfie FROM users WHERE id = ?').get(order.rider_id);
    if (r) {
      out.rider = {
        id: r.id, name: r.name, first_name: dispatch.firstName(r.name), phone: r.phone,
        vehicle_type: r.vehicle_type, vehicle_plate: r.vehicle_plate,
        live: r.live_lat != null ? { lat: r.live_lat, lng: r.live_lng, at: r.live_at } : null,
        has_photo: !!r.kyc_selfie,
      };
    }
  }
  if (role === 'rider') {
    // Codes the rider shows; the shop types them. Never sent to the shop.
    if (order.dispatch_stage === 'rider_assigned') out.pickup_code = order.pickup_code;
    if (order.dispatch_stage === 'returning') out.return_code = order.return_code;
  }
  return out;
}

/* ── Active work + offers ──────────────────────────────────────────────── */

router.get('/active', (req, res) => {
  const id = req.user.id;
  const orders = db.prepare(`
    SELECT * FROM consumer_orders
    WHERE (rider_id = ? OR delivery_dealer_id = ?)
      AND dispatch_stage IN (${ACTIVE_STAGES.map(() => '?').join(',')})
      AND dispatch_stage != 'trader_offer'
    ORDER BY updated_at DESC
  `).all(id, id, ...ACTIVE_STAGES).filter((o) => roleIn(o, id));
  const offers = db.prepare(`SELECT * FROM dispatch_offers WHERE user_id = ? AND response IS NULL ORDER BY offered_at`).all(id);
  res.json({
    orders: orders.map((o) => detail(o, id)),
    offers: offers.map((o) => ({ offer_id: o.id, kind: o.kind, expires_at: o.expires_at, card: dispatch.orderCard(getOrder(o.order_id), id, o.kind) })),
  });
});

router.get('/offers/:id', (req, res) => {
  const offer = db.prepare('SELECT * FROM dispatch_offers WHERE id = ?').get(req.params.id);
  if (!offer || offer.user_id !== req.user.id) return fail(res, 404, 'This order isn’t offered to you');
  const order = getOrder(offer.order_id);
  const card = dispatch.orderCard(order, req.user.id, offer.kind);
  res.json({
    offer_id: offer.id, kind: offer.kind, expires_at: offer.expires_at, open: !offer.response, response: offer.response,
    card, summary: dispatch.spokenSummary(card, offer.kind),
  });
});

async function answer(req, res, accept) {
  try {
    const orderId = await dispatch.respond(Number(req.params.id), req.user.id, accept, now());
    res.json({ ok: true, order_id: orderId });
  } catch (err) {
    if (err instanceof dispatch.DispatchError) return fail(res, err.status, err.message);
    console.error('[partner-orders] respond failed:', err);
    fail(res, 500, 'Something went wrong. Try again.');
  }
}

router.post('/offers/:id/accept', (req, res) => answer(req, res, true));
router.post('/offers/:id/decline', (req, res) => answer(req, res, false));

/* ── One order ─────────────────────────────────────────────────────────── */

router.get('/:id', (req, res) => {
  const got = load(req, res);
  if (!got) return;
  res.json(detail(got.order, req.user.id));
});

/** Packing takes the stock from the shop (same rule and checks as the website). */
router.post('/:id/packed', (req, res) => {
  const got = load(req, res, ['self', 'packer']);
  if (!got) return;
  const { order } = got;
  if (order.delivery_packed_at && ['packed', 'out_for_delivery'].includes(order.delivery_status)) return res.json({ ok: true, already: true });
  if (!['pending', 'accepted'].includes(order.delivery_status)) return fail(res, 409, 'This order can’t be packed now');
  try {
    deductOrderInventory(order.id, order.delivery_dealer_id);
  } catch (err) {
    return res.status(400).json({ error: err.message, hint: 'Not enough stock to pack this order. Call ST support to restock.' });
  }
  const t = nowIso();
  db.prepare(`
    UPDATE consumer_orders SET delivery_status = 'packed', delivery_packed_at = ?, delivery_accepted_at = COALESCE(delivery_accepted_at, ?),
      status = CASE WHEN status = 'confirmed' THEN 'processing' ELSE status END, updated_at = ?
    WHERE id = ?
  `).run(t, t, t, order.id);
  notifyConsumer(order, `Order packed — ${order.order_number}`, 'Your order has been packed and is almost ready for delivery.', { delivery_status: 'packed' });
  if (order.rider_id) pushTo(order.rider_id, 'Order is packed', `${order.order_number} is ready at the shop.`, { type: 'order_packed', order_id: order.id });
  emit(order);
  res.json({ ok: true });
});

/** Out for delivery: the customer gets their 6-digit code (in-app + email), as on the website. */
function beginDelivery(order) {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const t = nowIso();
  db.prepare(`
    UPDATE consumer_orders SET delivery_status = 'out_for_delivery', delivery_started_at = ?, delivery_otp = ?, status = 'shipped', updated_at = ?
    WHERE id = ?
  `).run(t, otp, t, order.id);
  notifyConsumer(order, `Your delivery is on the way — ${order.order_number}`,
    `Your order is out for delivery. Your delivery code is: ${otp}. Show this to the delivery agent.`,
    { delivery_status: 'out_for_delivery', otp });
  const consumer = db.prepare('SELECT name, email FROM consumers WHERE id = ?').get(order.consumer_id);
  if (consumer?.email) {
    sendOutForDeliveryEmail(consumer.email, consumer.name, order.order_number).catch(() => {});
    sendDeliveryOtpEmail(consumer.email, consumer.name, otp, order.order_number).catch(() => {});
  }
}

router.post('/:id/start', (req, res) => {
  const got = load(req, res, ['self']);
  if (!got) return;
  const { order } = got;
  if (order.delivery_status === 'out_for_delivery') return res.json({ ok: true, already: true });
  if (order.delivery_status !== 'packed') return fail(res, 409, 'Pack the order first');
  beginDelivery(order);
  emit(order);
  res.json({ ok: true });
});

/** Rider tapped "I'm at the shop": the shop gets a heads-up to have it ready and ask for the code. */
router.post('/:id/at-shop', (req, res) => {
  const got = load(req, res, ['rider']);
  if (!got) return;
  const { order } = got;
  if (order.dispatch_stage !== 'rider_assigned') return fail(res, 409, 'This order isn’t waiting for pickup');
  const rider = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const first = dispatch.firstName(rider?.name);
  pushTo(order.delivery_dealer_id, `${first} is at your shop`, `${order.order_number}: ask ${first} for their pickup code.`, { type: 'rider_assigned', order_id: order.id });
  res.json({ ok: true });
});

router.post('/:id/handover', (req, res) => {
  const got = load(req, res, ['packer']);
  if (!got) return;
  const { order } = got;
  if (order.dispatch_stage !== 'rider_assigned') return fail(res, 409, 'No rider is picking this up right now');
  if (order.delivery_status !== 'packed') return fail(res, 409, 'Pack the order first');
  if (String(req.body?.code || '').trim() !== String(order.pickup_code)) return fail(res, 400, 'That code doesn’t match. Ask the rider to show their code again.');
  db.prepare(`UPDATE consumer_orders SET dispatch_stage = 'picked_up', picked_up_at = ?, pickup_code = NULL WHERE id = ?`).run(nowIso(), order.id);
  beginDelivery(order);
  pushTo(order.rider_id, 'Picked up', `${order.order_number}: now take it to the customer.`, { type: 'picked_up', order_id: order.id });
  emit(order);
  res.json({ ok: true });
});

const wrongCode = (res) => fail(res, 400, 'That code doesn’t match. Ask the customer to read it again from their order.');

/** Lets the app say "Code is correct" before the photo; the photo step checks it again. */
router.post('/:id/check-code', (req, res) => {
  const got = load(req, res, ['self', 'rider']);
  if (!got) return;
  const { order } = got;
  if (order.delivery_status !== 'out_for_delivery') return fail(res, 409, 'This order isn’t out for delivery');
  const tries = db.prepare(`UPDATE consumer_orders SET delivery_otp_attempts = COALESCE(delivery_otp_attempts, 0) + 1 WHERE id = ? RETURNING delivery_otp_attempts AS n`).get(order.id).n;
  if (tries > 10) return fail(res, 429, 'Too many tries. Send the customer a new code.');
  if (!order.delivery_otp || String(req.body?.otp || '').trim() !== String(order.delivery_otp)) return wrongCode(res);
  res.json({ ok: true });
});

router.post('/:id/resend-code', (req, res) => {
  const got = load(req, res, ['self', 'rider']);
  if (!got) return;
  const { order } = got;
  if (order.delivery_status !== 'out_for_delivery') return fail(res, 409, 'This order isn’t out for delivery');
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare('UPDATE consumer_orders SET delivery_otp = ?, delivery_otp_attempts = 0, updated_at = ? WHERE id = ?').run(otp, nowIso(), order.id);
  notifyConsumer(order, `New delivery code — ${order.order_number}`, `Your new delivery code is: ${otp}. Show this to the delivery agent.`, { delivery_status: 'out_for_delivery', otp });
  const consumer = db.prepare('SELECT name, email FROM consumers WHERE id = ?').get(order.consumer_id);
  if (consumer?.email) sendDeliveryOtpEmail(consumer.email, consumer.name, otp, order.order_number).catch(() => {});
  res.json({ ok: true });
});

/**
 * Delivered: the customer's code and a photo of the package at the door, both required.
 * On rider orders the rider's fee is booked and the trader's commission becomes their share.
 */
router.post('/:id/deliver', uploadProof('photo', 'doors'), (req, res) => {
  const got = load(req, res, ['self', 'rider']);
  if (!got) return;
  const { order, role } = got;
  if (order.delivery_status !== 'out_for_delivery') return fail(res, 409, 'This order isn’t out for delivery');
  if (!req.file) return fail(res, 400, 'Take a photo of the package at the door');
  if (!order.delivery_otp || String(req.body?.otp || '').trim() !== String(order.delivery_otp)) return wrongCode(res);
  const t = nowIso();
  let earned = 0;
  db.transaction(() => {
    db.prepare(`
      UPDATE consumer_orders SET delivery_status = 'delivered', delivery_verified_at = ?, delivery_otp = NULL, status = 'delivered',
        dispatch_stage = 'delivered', door_photo_url = ?, updated_at = ?
      WHERE id = ?
    `).run(t, req.file.url, t, order.id);
    if (role === 'rider') earned = settleRiderDelivery(order, req.user.id);
  })();
  try { markHoldingsDelivered(order.id); } catch (err) { console.error('[partner-orders] holdings:', err.message); }
  try { syncAdminDeliveryCommission(order.id); } catch (err) { console.error('[partner-orders] commission routing:', err.message); }
  if (role === 'self') earned = dispatch.orderCard(getOrder(order.id), req.user.id, 'trader').earn;
  notifyConsumer(order, `Order delivered — ${order.order_number}`, 'Your order has been successfully delivered. Thank you for shopping with Sanathana Tattva!', { delivery_status: 'delivered' });
  if (role === 'rider') pushTo(order.delivery_dealer_id, 'Delivered', `${order.order_number} reached the customer.`, { type: 'delivered', order_id: order.id });
  emit(order);
  res.json({ ok: true, earned });
});

/** Rider fee as its own commission row; the linked trader keeps their configured share (pending rows only). */
function settleRiderDelivery(order, riderId) {
  const fee = order.rider_fee ?? dispatch.riderFee();
  const today = new Date();
  const ws = new Date(today); ws.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const we = new Date(ws); we.setDate(ws.getDate() + 6);
  db.prepare(`
    INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status, week_start, week_end)
    VALUES (?, ?, ?, 0, 'delivery_fee', 'pending', ?, ?)
  `).run(riderId, order.id, fee, ws.toISOString().slice(0, 10), we.toISOString().slice(0, 10));
  const share = dispatch.traderShare();
  db.prepare(`
    UPDATE commissions SET original_amount = COALESCE(original_amount, amount), amount = ROUND(COALESCE(original_amount, amount) * ? / 100.0, 2)
    WHERE consumer_order_id = ? AND type = 'direct' AND status = 'pending'
  `).run(share, order.id);
  return fee;
}

const FAIL_REASONS = ['not_home', 'phone_off', 'wrong_address', 'refused', 'unsafe', 'other'];

/**
 * Couldn't deliver. A rider brings it back to the shop (return code); a trader already has it.
 * Either way it's offered again the next day from the shop's hours, trader first.
 */
router.post('/:id/fail', (req, res) => {
  const got = load(req, res, ['self', 'rider']);
  if (!got) return;
  const { order, role } = got;
  const reason = String(req.body?.reason || '');
  if (!FAIL_REASONS.includes(reason)) return fail(res, 400, 'Pick what happened');
  const note = String(req.body?.note || '').slice(0, 200);
  if (order.delivery_status !== 'out_for_delivery') return fail(res, 409, 'This order isn’t out for delivery');
  const t = nowIso();
  const text = note ? `${reason}: ${note}` : reason;
  db.prepare(`
    UPDATE consumer_orders SET delivery_status = 'failed', delivery_failed_reason = ?, delivery_otp = NULL,
      attempt_count = attempt_count + 1, updated_at = ?
    WHERE id = ?
  `).run(text, t, order.id);
  if (role === 'rider') {
    db.prepare(`UPDATE consumer_orders SET dispatch_stage = 'returning', return_code = ? WHERE id = ?`).run(dispatch.code4(), order.id);
    pushTo(order.delivery_dealer_id, 'Coming back to your shop', `${order.order_number} couldn’t be delivered. The rider is bringing it back.`, { type: 'returning', order_id: order.id });
  } else {
    scheduleRetry(order);
  }
  notifyConsumer(order, `We couldn’t deliver ${order.order_number}`, 'We’ll try again tomorrow. Reply in your order if anything needs to change.', { delivery_status: 'failed', reason });
  emit(order);
  res.json({ ok: true });
});

/** Back on the shelf, packed; offered again from the shop's next opening tomorrow or later. */
function scheduleRetry(order) {
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const { ist } = hours.localClock(tomorrow);
  const tomorrowMidnight = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60000);
  const opens = order.delivery_dealer_id ? hours.nextOpening(order.delivery_dealer_id, tomorrowMidnight) : null;
  const when = opens || tomorrowMidnight;
  db.prepare(`
    UPDATE consumer_orders SET dispatch_stage = 'retry_wait', retry_on = ?, delivery_status = 'packed', rider_id = NULL,
      return_code = NULL, pickup_code = NULL, updated_at = ?
    WHERE id = ?
  `).run(when.toISOString(), nowIso(), order.id);
}

router.post('/:id/returned', (req, res) => {
  const got = load(req, res, ['packer']);
  if (!got) return;
  const { order } = got;
  if (order.dispatch_stage !== 'returning') return fail(res, 409, 'Nothing is coming back for this order');
  if (String(req.body?.code || '').trim() !== String(order.return_code)) return fail(res, 400, 'That code doesn’t match. Ask the rider to show their code again.');
  const riderId = order.rider_id;
  scheduleRetry(order);
  pushTo(riderId, 'Handed back', `${order.order_number} is back at the shop. You’re free for the next order.`, { type: 'returned', order_id: order.id });
  emit(order);
  res.json({ ok: true });
});

/** The Call button dials this; the app never prints it (handoff §4.12). */
router.get('/:id/customer-phone', (req, res) => {
  const got = load(req, res, ['self', 'rider']);
  if (!got) return;
  if (got.order.delivery_status !== 'out_for_delivery') return fail(res, 403, 'You can call only while delivering');
  const c = db.prepare('SELECT phone FROM consumers WHERE id = ?').get(got.order.consumer_id);
  const phone = got.order.delivery_phone || c?.phone;
  if (!phone) return fail(res, 404, 'No phone number on this order');
  res.set('Cache-Control', 'private, no-store').json({ phone });
});

/** The rider's selfie, small, for the shop to recognise them at pickup. Never cached. */
router.get('/:id/rider-photo', (req, res) => {
  const got = load(req, res, ['packer']);
  if (!got) return;
  const r = got.order.rider_id && db.prepare('SELECT id, kyc_selfie FROM users WHERE id = ?').get(got.order.rider_id);
  if (!r?.kyc_selfie) return fail(res, 404, 'No photo');
  const file = kycFilePath(r.kyc_selfie, 'thumb');
  if (!file || !fs.existsSync(file)) return fail(res, 404, 'No photo');
  res.set('Cache-Control', 'private, no-store').type('image/webp');
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
module.exports.FAIL_REASONS = FAIL_REASONS;
