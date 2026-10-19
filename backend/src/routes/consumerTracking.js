/**
 * Customer order tracking (handoff §4.13, canvas "CustomerTracking" / "CustomerOffHours").
 *
 *   GET /api/consumer/orders/:id/tracking      stage, steps, who is bringing it, live position, delivery code
 *   GET /api/consumer/orders/:id/rider-photo   the rider's small photo, only while they have the order
 *   GET /api/consumer/orders/:id/call          the number to call, only while it is on its way
 *
 * The rider's details exist for the customer only between "rider accepted" and "delivered".
 */
const express = require('express');
const fs = require('fs');
const db = require('../database/db');
const { authConsumer } = require('./consumer');
const dispatch = require('../services/dispatch');
const hours = require('../services/deliveryHours');
const { kycFilePath } = require('../services/kycStorage');
const { haversineDistance } = require('../services/h3Service');

const router = express.Router();

const LIVE_FRESH_MS = 10 * 60_000;
const RIDER_STAGES = ['rider_assigned', 'picked_up'];
const VEHICLES = { walk: 'On foot', cycle: 'Cycle', scooter: 'Scooter', bike: 'Bike' };

function ownOrder(req, res) {
  const order = db.prepare('SELECT * FROM consumer_orders WHERE id = ? AND consumer_id = ?').get(req.params.id, req.consumer.id);
  if (!order) res.status(404).json({ error: 'Order not found' });
  return order;
}

/** Placed → Packed → On the way → Delivered, as one index (0–3). */
function stepOf(o) {
  if (o.delivery_status === 'delivered') return 3;
  if (o.delivery_status === 'out_for_delivery') return 2;
  if (o.delivery_status === 'packed') return 1;
  return 0;
}

/** Who is bringing it, when that is a person the customer should see. */
function bringer(o) {
  if (o.rider_id && RIDER_STAGES.includes(o.dispatch_stage)) {
    const r = db.prepare('SELECT id, name, vehicle_type, vehicle_plate, kyc_selfie, live_lat, live_lng, live_at FROM users WHERE id = ?').get(o.rider_id);
    if (!r) return null;
    const fresh = r.live_at && Date.now() - dispatch.toDate(r.live_at) < LIVE_FRESH_MS;
    return {
      kind: 'rider',
      first_name: dispatch.firstName(r.name),
      vehicle: VEHICLES[r.vehicle_type] || null,
      plate: r.vehicle_plate || null,
      has_photo: !!r.kyc_selfie,
      live: fresh ? { lat: r.live_lat, lng: r.live_lng, at: r.live_at } : null,
    };
  }
  if (o.delivery_status === 'out_for_delivery' && o.delivery_dealer_id) {
    const s = db.prepare('SELECT name, live_lat, live_lng, live_at FROM users WHERE id = ?').get(o.delivery_dealer_id);
    if (!s) return null;
    const fresh = s.live_at && Date.now() - dispatch.toDate(s.live_at) < LIVE_FRESH_MS;
    return {
      kind: 'shop', first_name: s.name, vehicle: null, plate: null, has_photo: false,
      live: fresh ? { lat: s.live_lat, lng: s.live_lng, at: s.live_at } : null,
    };
  }
  return null;
}

router.get('/orders/:id/tracking', authConsumer, (req, res) => {
  const o = ownOrder(req, res);
  if (!o) return;
  const step = stepOf(o);
  const who = bringer(o);
  const shopName = o.delivery_dealer_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.delivery_dealer_id)?.name : null;

  let state = 'placed';
  let headline = 'Order placed';
  let note = null;
  let opensAt = null;

  if (o.status === 'cancelled' || o.delivery_status === 'cancelled') {
    state = 'cancelled'; headline = 'Order cancelled';
  } else if (o.delivery_status === 'delivered') {
    state = 'delivered'; headline = 'Delivered';
  } else if (o.dispatch_stage === 'awaiting_hours') {
    state = 'scheduled';
    opensAt = o.dispatch_started_at;
    const opens = dispatch.toDate(o.dispatch_started_at);
    const { minutes } = hours.localClock(opens);
    headline = `Will be delivered from ${hours.clockText(minutes)}`;
    const today = hours.localClock(new Date()).ist.toISOString().slice(0, 10);
    const when = hours.localClock(opens).ist.toISOString().slice(0, 10) === today ? 'later today' : 'tomorrow morning';
    const week = o.delivery_dealer_id ? hours.getHours(o.delivery_dealer_id) : null;
    const d = week?.days.find((x) => x.enabled);
    note = `${d ? `Your shop delivers ${hours.clockText(d.start)} – ${hours.clockText(d.end)}. ` : ''}Your order is placed and first in line for ${when}.`;
  } else if (['returning', 'retry_wait'].includes(o.dispatch_stage)) {
    state = 'retry'; headline = 'We’ll try again tomorrow';
    note = 'We couldn’t reach you this time. Your order is safe at the shop and comes again tomorrow.';
  } else if (o.delivery_status === 'out_for_delivery') {
    state = 'on_the_way';
    headline = who?.kind === 'rider' ? `${who.first_name} is bringing your order` : `${shopName || 'Your shop'} is bringing your order`;
  } else if (o.dispatch_stage === 'rider_assigned' && who) {
    state = 'rider_coming';
    headline = `${who.first_name} is picking up your order`;
  } else if (o.delivery_status === 'packed') {
    state = 'packed'; headline = 'Packed and ready';
  } else if (['accepted', 'pending'].includes(o.delivery_status) && o.dispatch_stage === 'trader_accepted') {
    state = 'packing'; headline = 'Your shop is packing your order';
  }

  const active = ['on_the_way', 'rider_coming'].includes(state);
  const dest = o.delivery_latitude != null ? { lat: o.delivery_latitude, lng: o.delivery_longitude } : null;
  const km = who?.live && dest ? Math.round(haversineDistance(who.live.lat, who.live.lng, dest.lat, dest.lng) * 10) / 10 : null;

  res.set('Cache-Control', 'private, no-store').json({
    order_id: o.id,
    order_number: o.order_number,
    state,
    step,
    headline,
    note,
    opens_at: opensAt,
    bringer: active ? who : null,
    destination: active ? dest : null,
    distance_km: active ? km : null,
    // The customer's own code: shown from "on the way" until it is used.
    delivery_code: o.delivery_status === 'out_for_delivery' ? o.delivery_otp || null : null,
    can_call: state === 'on_the_way' || state === 'rider_coming',
    lines: dispatch.orderLines(o.id),
    paid_online: o.payment_status === 'paid',
  });
});

router.get('/orders/:id/rider-photo', authConsumer, (req, res) => {
  const o = ownOrder(req, res);
  if (!o) return;
  if (!o.rider_id || !RIDER_STAGES.includes(o.dispatch_stage)) return res.status(404).json({ error: 'No photo' });
  const r = db.prepare('SELECT kyc_selfie FROM users WHERE id = ?').get(o.rider_id);
  const file = r?.kyc_selfie && kycFilePath(r.kyc_selfie, 'thumb');
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'No photo' });
  res.set('Cache-Control', 'private, no-store').type('image/webp');
  fs.createReadStream(file).pipe(res);
});

router.get('/orders/:id/call', authConsumer, (req, res) => {
  const o = ownOrder(req, res);
  if (!o) return;
  const riderActive = o.rider_id && RIDER_STAGES.includes(o.dispatch_stage);
  const shopDelivering = o.delivery_status === 'out_for_delivery' && !riderActive;
  if (!riderActive && !shopDelivering) return res.status(403).json({ error: 'You can call only while your order is on its way' });
  const who = db.prepare('SELECT phone FROM users WHERE id = ?').get(riderActive ? o.rider_id : o.delivery_dealer_id);
  if (!who?.phone) return res.status(404).json({ error: 'No phone number to call' });
  res.set('Cache-Control', 'private, no-store').json({ phone: who.phone });
});

module.exports = router;
