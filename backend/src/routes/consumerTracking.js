/**
 * Customer order tracking (handoff §4.13, canvas "CustomerTracking" / "CustomerOffHours").
 *
 *   GET /api/consumer/orders/:id/tracking      stage, steps, who is bringing it, live position, delivery code,
 *                                              the shop and the delivery partner, and a timed history
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
// Website-side order status, in the order it moves.
const STATUS_ORDER = ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'dispatched', 'out_for_delivery', 'delivered'];
const reached = (o, status) => STATUS_ORDER.indexOf(o.status) >= STATUS_ORDER.indexOf(status);
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

const iso = (s) => (s ? dispatch.toDate(s).toISOString() : null);

/** The shop that has the order (or will get it): the one that accepted it, else the customer's linked trader. */
function shopFor(o) {
  const id = o.delivery_dealer_id || o.linked_dealer_id;
  if (!id) return null;
  const u = db.prepare('SELECT id, name, address, latitude, longitude FROM users WHERE id = ?').get(id);
  if (!u) return null;
  const place = db.prepare('SELECT address, latitude, longitude FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id LIMIT 1').get(id);
  const lat = place?.latitude ?? u.latitude;
  const lng = place?.longitude ?? u.longitude;
  return {
    id: u.id,
    name: u.name,
    area: dispatch.areaOf(place?.address || u.address) || null,
    is_linked: !!o.linked_dealer_id && o.linked_dealer_id === u.id,
    location: lat != null && lng != null ? { lat, lng } : null,
  };
}

/** The rider who took it, once they accepted. Their name stays in the history after delivery; nothing else does. */
function riderOf(o) {
  if (!o.rider_id) return null;
  const r = db.prepare('SELECT name FROM users WHERE id = ?').get(o.rider_id);
  const offer = db.prepare(`SELECT responded_at FROM dispatch_offers WHERE order_id = ? AND user_id = ? AND kind = 'rider' AND response = 'accepted' ORDER BY id DESC LIMIT 1`).get(o.id, o.rider_id);
  return { first_name: dispatch.firstName(r?.name), accepted_at: iso(offer?.responded_at) };
}

/**
 * Everything that happened, oldest first, then what is still to come.
 * state: done | now | next. "now" is the latest thing that happened while the order is still moving.
 */
function historyOf(o, shop, rider, finished) {
  const shopName = shop?.name || 'Your shop';
  const done = [];
  const add = (key, title, at, detail = null) => done.push({ key, title, detail, at: iso(at) });

  // Orders moved on the website only change `status`; those steps show without a time.
  add('placed', 'Order placed', o.created_at, o.payment_status === 'paid' ? 'Paid online' : null);
  if (o.delivery_accepted_at) add('accepted', `${shopName} accepted it`, o.delivery_accepted_at, shop?.is_linked ? 'Your linked partner' : 'Partner shop');
  if (o.delivery_packed_at || reached(o, 'packed')) add('packed', 'Packed and ready', o.delivery_packed_at);
  if (rider?.accepted_at) add('rider', `${rider.first_name} will deliver it`, rider.accepted_at, 'Delivery partner');
  if (o.picked_up_at && rider) add('picked_up', `${rider.first_name} picked it up`, o.picked_up_at, `From ${shopName}`);
  else if (o.delivery_started_at) add('out', `${shopName} set out with it`, o.delivery_started_at, 'Same person from packing to your door');
  else if (reached(o, 'shipped')) add('out', 'On the way to you', null);
  if (['returning', 'retry_wait'].includes(o.dispatch_stage)) add('retry', 'We couldn’t reach you', o.updated_at, 'It comes again tomorrow');
  if (o.delivery_status === 'delivered' || o.status === 'delivered') add('delivered', 'Delivered', o.delivery_verified_at || o.updated_at);
  if (o.status === 'cancelled' || o.delivery_status === 'cancelled') add('cancelled', 'Order cancelled', o.updated_at);

  const events = done.map((e, i) => ({ ...e, state: !finished && i === done.length - 1 ? 'now' : 'done' }));
  if (finished) return events;

  // Only steps after the furthest one reached are still to come.
  const has = (...keys) => done.some((e) => keys.includes(e.key));
  if (!has('accepted', 'packed', 'rider', 'picked_up', 'out')) events.push({ key: 'accepted', title: 'Your shop accepts it', detail: null, at: null, state: 'next' });
  if (!has('packed', 'picked_up', 'out')) events.push({ key: 'packed', title: 'Packed and ready', detail: null, at: null, state: 'next' });
  if (!has('picked_up', 'out')) events.push({ key: 'out', title: 'On the way to you', detail: null, at: null, state: 'next' });
  events.push({ key: 'delivered', title: 'Delivered', detail: o.delivery_otp ? `Share code ${o.delivery_otp} at your door` : null, at: null, state: 'next' });
  return events;
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
  } else if (o.delivery_status === 'delivered' || o.status === 'delivered') {
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
  } else if (!o.dispatch_stage && reached(o, 'shipped')) {
    // Moved on the website, which only changes `status`.
    state = 'on_the_way'; headline = 'Your order is on the way';
  } else if (!o.dispatch_stage && reached(o, 'packed')) {
    state = 'packed'; headline = 'Packed and ready';
  } else if (!o.dispatch_stage && reached(o, 'confirmed')) {
    state = 'packing'; headline = 'Your order is being packed';
  }

  const active = ['on_the_way', 'rider_coming'].includes(state);
  const dest = o.delivery_latitude != null ? { lat: o.delivery_latitude, lng: o.delivery_longitude } : null;
  const km = who?.live && dest ? Math.round(haversineDistance(who.live.lat, who.live.lng, dest.lat, dest.lng) * 10) / 10 : null;

  const finished = state === 'delivered' || state === 'cancelled';
  const shop = shopFor(o);
  const rider = riderOf(o);
  // Who brings it to the door: the rider once one accepted, else the shop once it set out itself.
  let deliveryPartner = null;
  if (o.rider_id && rider) {
    deliveryPartner = {
      kind: 'rider',
      name: rider.first_name,
      vehicle: active && who?.kind === 'rider' ? who.vehicle : null,
      plate: active && who?.kind === 'rider' ? who.plate : null,
      has_photo: active && who?.kind === 'rider' ? who.has_photo : false,
      live: active && who?.kind === 'rider' ? who.live : null,
    };
  } else if (o.delivery_started_at && o.delivery_dealer_id) {
    deliveryPartner = { kind: 'shop', name: shop?.name || shopName, vehicle: null, plate: null, has_photo: false, live: active && who?.kind === 'shop' ? who.live : null };
  }

  res.set('Cache-Control', 'private, no-store').json({
    placed_at: iso(o.created_at),
    linked_partner: shop ? { name: shop.name, area: shop.area, is_linked: shop.is_linked, location: finished ? null : shop.location } : null,
    delivery_partner: deliveryPartner,
    same_person: deliveryPartner?.kind === 'shop' && !!shop && o.delivery_dealer_id === shop.id,
    // The customer's own address, for the map.
    home: !finished && o.delivery_latitude != null ? { lat: o.delivery_latitude, lng: o.delivery_longitude } : null,
    events: historyOf(o, shop, rider, finished),
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
    can_call: active && !!who,
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
