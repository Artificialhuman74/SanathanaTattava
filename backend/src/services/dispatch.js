/**
 * ST Partner dispatch (handoff §4.4, §6.2): how a paid order reaches a person.
 *
 *   1. Owner trader: the customer's linked trader, else the trader the website assigned.
 *      - Trader doesn't deliver (will_deliver = 0) → rider search at once; the trader packs.
 *      - Outside the trader's delivery hours → wait (awaiting_hours) until they open.
 *      - Otherwise a 20-minute offer rings the trader, re-ringing every 2 minutes.
 *   2. "I can't deliver" or 20 minutes pass → rider search: nearest eligible rider to the
 *      shop first, each with the same 20 minutes / 2-minute re-rings, until one accepts.
 *      Skip or timeout → next rider. 3 misses in a row → that rider is set offline.
 *   3. Nobody after 30 minutes of searching → admin is alerted (searching continues).
 *
 * consumer_orders.dispatch_stage:
 *   awaiting_hours → trader_offer → trader_accepted                          (trader delivers)
 *                               ↘ rider_search → rider_assigned → picked_up  (rider delivers)
 *   → delivered | returning (failed, rider brings it back) → retry_wait → (next day) again
 *   admin: no trader at all; admin handles it on the website.
 *
 * Everything time-based runs from tick(now), called every 30 s from index.js and directly
 * (with a fake clock) in tests. Pushes never block: a failed push is logged and retried by
 * the next re-ring.
 */
const crypto = require('crypto');
const db = require('../database/db');
const hours = require('./deliveryHours');
const { haversineDistance } = require('./h3Service');
const { sendDataToUser, sendToUser } = require('./pushService');
const { createNotification } = require('./notificationService');
const { emitAdminEvent, emitOrderUpdate } = require('../websocket/socketServer');

const OFFER_MS = 20 * 60_000;
const REALERT_MS = 2 * 60_000;
const ADMIN_ALERT_MS = 30 * 60_000;
const RIDER_RADIUS_KM = 10;
const LIVE_FRESH_MS = 10 * 60_000;
const MISS_LIMIT = 3;

/* ── Settings (admin-editable, handoff §4.11) ──────────────────────────── */

function setting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

const isEnabled = () => setting('partner_dispatch_enabled', '0') === '1';
const enabledSince = () => setting('partner_dispatch_enabled_at', '1970-01-01T00:00:00.000Z');

function riderFee() {
  const n = Number(setting('rider_fee_per_delivery', '45'));
  return Number.isFinite(n) && n >= 0 ? n : 45;
}

/** Trader's share of their usual commission on rider-delivered orders, in %. */
function traderShare() {
  const n = Number(setting('trader_share_on_rider_orders', '70'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 70;
}

/* ── Small helpers ─────────────────────────────────────────────────────── */

const iso = (d) => new Date(d).toISOString();

/** SQLite CURRENT_TIMESTAMP ("2026-10-19 07:00:00", UTC) or ISO → Date. */
function toDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
}

const code4 = () => String(crypto.randomInt(1000, 10000));

function getOrder(id) {
  return db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(id);
}

function setStage(orderId, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE consumer_orders SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), iso(Date.now()), orderId);
}

function emit(order) {
  try {
    const o = getOrder(order.id);
    emitOrderUpdate({
      orderId: o.id, orderNumber: o.order_number, status: o.status, deliveryStatus: o.delivery_status,
      consumerId: o.consumer_id, linkedDealerId: o.linked_dealer_id, deliveryDealerId: o.delivery_dealer_id,
      extra: { dispatchStage: o.dispatch_stage, riderId: o.rider_id },
    });
  } catch (_) { /* sockets are best-effort */ }
}

function log(order, msg) {
  console.log(`[dispatch] ${order.order_number || order.id}: ${msg}`);
}

/* ── What an order is (for offers, cards, the spoken announcement) ─────── */

function lineType(item) {
  if (item.is_refill === 1 || item.is_refill === true) return 'refill';
  if ((item.container_cost || 0) > 0) return 'new';
  return 'standard';
}

/** "5L" / "2.8 L" / "500ml" → litres. */
function litresOf(containerType, unit) {
  const s = String(containerType || unit || '').toLowerCase().replace(/\s/g, '');
  const l = s.match(/^([\d.]+)l$/);
  if (l) return Number(l[1]);
  const ml = s.match(/^([\d.]+)ml$/);
  if (ml) return Number(ml[1]) / 1000;
  return null;
}

function orderLines(orderId) {
  return db.prepare(`
    SELECT coi.quantity, coi.is_refill, coi.container_cost, p.name, p.image_url, p.unit, p.container_type
    FROM consumer_order_items coi LEFT JOIN products p ON p.id = coi.product_id
    WHERE coi.order_id = ?
  `).all(orderId).map((it) => ({
    name: it.name || 'Item',
    quantity: it.quantity,
    size: it.container_type || it.unit || null,
    litres: litresOf(it.container_type, it.unit),
    image_url: it.image_url || null,
    line_type: lineType(it),
  }));
}

function loadOf(lines) {
  const cans = lines.reduce((a, l) => a + (l.litres ? l.quantity : 0), 0);
  const litres = lines.reduce((a, l) => a + (l.litres ? l.litres * l.quantity : 0), 0);
  return { cans, litres: Math.round(litres * 10) / 10 };
}

/** "Jayanagar 4th Block" from a full address: the part after the house/street, before the city. */
function areaOf(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean)
    .filter((p) => !/^\d{6}$/.test(p) && !/bengaluru|bangalore|karnataka|india/i.test(p));
  if (parts.length <= 1) return parts[0] || '';
  return parts[parts.length - 1].replace(/\s*\d{6}$/, '');
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Customer';

function shopOf(order) {
  return db.prepare('SELECT id, name, phone, address, latitude, longitude FROM users WHERE id = ?').get(order.delivery_dealer_id);
}

function km(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some((v) => v == null || !Number.isFinite(Number(v)))) return null;
  return Math.round(haversineDistance(aLat, aLng, bLat, bLng) * 10) / 10;
}

/** Where a partner is for matching: a fresh live fix, else their default start place. */
function positionOf(user, now) {
  if (user.live_lat != null && user.live_at && now - toDate(user.live_at) < LIVE_FRESH_MS) {
    return { lat: user.live_lat, lng: user.live_lng };
  }
  const place = db.prepare('SELECT latitude, longitude FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id LIMIT 1').get(user.id);
  if (place) return { lat: place.latitude, lng: place.longitude };
  if (user.latitude != null) return { lat: user.latitude, lng: user.longitude };
  return null;
}

/** What this trader earns on the order (their direct commission). */
function commissionFor(orderId, userId) {
  const r = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS a FROM commissions WHERE consumer_order_id = ? AND trader_id = ? AND type IN ('direct','override') AND status != 'cancelled'`).get(orderId, userId);
  return Math.round(r.a * 100) / 100;
}

/** The card both the ring and the order screens show. Before accepting: name + area only. */
function orderCard(order, viewer, kind, now = Date.now()) {
  const lines = orderLines(order.id);
  const consumer = db.prepare('SELECT name FROM consumers WHERE id = ?').get(order.consumer_id);
  const shop = shopOf(order);
  const card = {
    order_id: order.id,
    order_number: order.order_number,
    lines,
    load: loadOf(lines),
    total: order.total_amount,
    paid_online: order.payment_status === 'paid',
    customer: { first_name: firstName(consumer?.name), area: areaOf(order.delivery_address) },
    shop: shop ? { name: shop.name, area: areaOf(shop.address) } : null,
  };
  if (kind === 'rider') {
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(viewer);
    const pos = me && positionOf(me, now);
    card.earn = order.rider_fee ?? riderFee();
    card.to_shop_km = pos && shop ? km(pos.lat, pos.lng, shop.latitude, shop.longitude) : null;
    card.shop_to_customer_km = shop ? km(shop.latitude, shop.longitude, order.delivery_latitude, order.delivery_longitude) : null;
  } else {
    card.earn = commissionFor(order.id, viewer);
    card.distance_km = shop ? km(shop.latitude, shop.longitude, order.delivery_latitude, order.delivery_longitude) : (order.delivery_distance_km ?? null);
  }
  return card;
}

/** One line for the spoken announcement and the notification text. */
function spokenSummary(card, kind) {
  const what = card.lines.map((l) => `${l.quantity} × ${[l.size, l.name].filter(Boolean).join(' ')}${l.line_type === 'refill' ? ' (refill)' : l.line_type === 'new' ? ' (new can)' : ''}`).join(', ');
  return kind === 'rider'
    ? `${what}. Pick up from ${card.shop?.name || 'the shop'}${card.shop?.area ? `, ${card.shop.area}` : ''}.`
    : `${what} for ${card.customer.first_name}${card.customer.area ? `, ${card.customer.area}` : ''}.`;
}

/* ── Offers ────────────────────────────────────────────────────────────── */

function openOffersFor(orderId) {
  return db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? AND response IS NULL').all(orderId);
}

function closeOffer(offerId, response, now) {
  db.prepare('UPDATE dispatch_offers SET response = ?, responded_at = ? WHERE id = ? AND response IS NULL').run(response, iso(now), offerId);
}

async function ring(offer, now, reminder) {
  const order = getOrder(offer.order_id);
  const card = orderCard(order, offer.user_id, offer.kind, now);
  db.prepare('UPDATE dispatch_offers SET last_alert_at = ?, alert_count = alert_count + 1 WHERE id = ?').run(iso(now), offer.id);
  try {
    await sendDataToUser(offer.user_id, {
      type: 'order_offer',
      offer_id: offer.id,
      order_id: order.id,
      role: offer.kind,
      reminder: reminder ? '1' : '0',
      expires_at: offer.expires_at,
      summary: spokenSummary(card, offer.kind),
      earn: card.earn,
    });
  } catch (err) {
    console.error('[dispatch] ring failed:', err.message);
  }
}

function makeOffer(order, userId, kind, now) {
  const expires = iso(now + OFFER_MS);
  const id = db.prepare(`
    INSERT INTO dispatch_offers (order_id, user_id, kind, offered_at, expires_at) VALUES (?, ?, ?, ?, ?)
  `).run(order.id, userId, kind, iso(now), expires).lastInsertRowid;
  return db.prepare('SELECT * FROM dispatch_offers WHERE id = ?').get(id);
}

/* ── Starting dispatch ─────────────────────────────────────────────────── */

function ownerTrader(order) {
  const pick = (id) => id && db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'trader' AND status = 'active'`).get(id);
  return pick(order.linked_dealer_id) || pick(order.delivery_dealer_id) || null;
}

async function start(order, now) {
  const owner = ownerTrader(order);
  if (!owner) {
    setStage(order.id, { dispatch_stage: 'admin', dispatch_started_at: iso(now) });
    await alertAdmin(order, 'No shop covers this order', now);
    log(order, 'no trader → admin');
    return;
  }
  if (order.delivery_dealer_id !== owner.id) setStage(order.id, { delivery_dealer_id: owner.id });
  if (!owner.will_deliver) {
    await escalate(getOrder(order.id), 'non_delivering_trader', now);
    return;
  }
  const opens = hours.nextOpening(owner.id, new Date(now));
  if (opens && opens.getTime() > now) {
    setStage(order.id, { dispatch_stage: 'awaiting_hours', dispatch_started_at: iso(opens) });
    log(order, `waits for ${owner.name}'s hours (${iso(opens)})`);
    return;
  }
  await offerTrader(getOrder(order.id), owner, now);
}

async function offerTrader(order, trader, now) {
  const offer = makeOffer(order, trader.id, 'trader', now);
  setStage(order.id, { dispatch_stage: 'trader_offer', dispatch_started_at: order.dispatch_started_at || iso(now), trader_offer_expires_at: offer.expires_at });
  log(order, `offered to trader ${trader.id}`);
  emit(order);
  await ring(offer, now, false);
}

/** The trader can't or won't deliver: they pack, and riders are asked. */
async function escalate(order, reason, now) {
  for (const o of openOffersFor(order.id)) closeOffer(o.id, reason === 'declined' ? 'declined' : 'expired', now);
  setStage(order.id, { dispatch_stage: 'rider_search', escalated_at: iso(now), escalation_reason: reason, rider_fee: riderFee() });
  log(order, `rider search (${reason})`);
  if (order.delivery_dealer_id) {
    sendToUser(order.delivery_dealer_id, {
      title: 'Pack this order',
      body: `${order.order_number}: a rider is coming to pick it up.`,
      data: { type: 'pack_request', order_id: String(order.id) },
      channelId: 'orders_info',
    }).catch(() => {});
  }
  emit(order);
  await offerNextRider(getOrder(order.id), now);
}

/* ── Riders ────────────────────────────────────────────────────────────── */

const BUSY_STAGES = `('rider_assigned','picked_up','returning')`;

function eligibleRiders(order, now) {
  const shop = shopOf(order);
  if (!shop || shop.latitude == null) return [];
  const candidates = db.prepare(`
    SELECT u.* FROM users u
    WHERE u.status = 'active' AND u.partner_online = 1
      AND ((u.role = 'rider' AND u.review_status = 'approved') OR (u.role = 'trader' AND u.takes_rider_jobs = 1))
      AND u.id != ?
      AND u.id NOT IN (SELECT user_id FROM dispatch_offers WHERE order_id = ?)
      AND u.id NOT IN (SELECT user_id FROM dispatch_offers WHERE response IS NULL)
      AND u.id NOT IN (SELECT rider_id FROM consumer_orders WHERE rider_id IS NOT NULL AND dispatch_stage IN ${BUSY_STAGES})
  `).all(shop.id, order.id);
  return candidates
    .map((u) => {
      const pos = positionOf(u, now);
      return pos ? { user: u, km: haversineDistance(shop.latitude, shop.longitude, pos.lat, pos.lng) } : null;
    })
    .filter((c) => c && c.km <= RIDER_RADIUS_KM)
    // Riders first at equal distance: traders' own shops come first for them (handoff §4.4 item 11).
    .sort((a, b) => a.km - b.km || (a.user.role === 'rider' ? -1 : 1));
}

async function offerNextRider(order, now) {
  if (order.dispatch_stage !== 'rider_search') return;
  if (openOffersFor(order.id).some((o) => o.kind === 'rider')) return;
  const [next] = eligibleRiders(order, now);
  if (!next) return;
  const offer = makeOffer(order, next.user.id, 'rider', now);
  log(order, `offered to rider ${next.user.id} (${next.km.toFixed(1)} km)`);
  await ring(offer, now, false);
}

async function missed(userId, now) {
  db.prepare('UPDATE users SET missed_offer_streak = missed_offer_streak + 1 WHERE id = ?').run(userId);
  const u = db.prepare('SELECT missed_offer_streak FROM users WHERE id = ?').get(userId);
  if (u.missed_offer_streak >= MISS_LIMIT) {
    db.prepare('UPDATE users SET partner_online = 0, auto_offline_at = ?, missed_offer_streak = 0 WHERE id = ?').run(iso(now), userId);
    sendDataToUser(userId, { type: 'auto_offline' }).catch(() => {});
    console.log(`[dispatch] rider ${userId} set offline after ${MISS_LIMIT} missed orders`);
  }
}

/* ── Admin alert ───────────────────────────────────────────────────────── */

async function alertAdmin(order, reason, now) {
  setStage(order.id, { admin_alerted_at: iso(now) });
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`).all();
  for (const a of admins) {
    try {
      createNotification('admin', a.id, `Needs you: ${order.order_number}`, reason, { order_id: order.id, kind: 'dispatch_alert' });
    } catch (_) { /* notifications table optional in some tests */ }
    sendToUser(a.id, { title: `Needs you: ${order.order_number}`, body: reason, data: { type: 'dispatch_alert', order_id: String(order.id) }, channelId: 'orders_info' }).catch(() => {});
  }
  try { emitAdminEvent('dispatch:alert', { orderId: order.id, orderNumber: order.order_number, reason }); } catch (_) {}
}

/* ── Responses from the app ────────────────────────────────────────────── */

class DispatchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Accept or say no to an offer. Traders "can't deliver"; riders "skip".
 * Returns the order id the partner should open next (accept), or null.
 */
async function respond(offerId, userId, accept, now = Date.now()) {
  const offer = db.prepare('SELECT * FROM dispatch_offers WHERE id = ?').get(offerId);
  if (!offer || offer.user_id !== userId) throw new DispatchError(404, 'This order isn’t offered to you');
  if (offer.response) throw new DispatchError(409, offer.response === 'accepted' ? 'You already accepted this order' : 'This order has gone to someone else');
  const order = getOrder(offer.order_id);

  if (offer.kind === 'trader') {
    if (accept) {
      closeOffer(offer.id, 'accepted', now);
      setStage(order.id, {
        dispatch_stage: 'trader_accepted',
        delivery_dealer_id: userId,
        delivery_status: order.delivery_status === 'pending' ? 'accepted' : order.delivery_status,
        delivery_accepted_at: order.delivery_accepted_at || iso(now),
      });
      notifyConsumer(order, `Delivery accepted — ${order.order_number}`, 'Your shop has accepted your order and will pack it now.');
      emit(order);
      log(order, `trader ${userId} accepted`);
      return order.id;
    }
    await escalate(order, 'declined', now);
    return null;
  }

  // Rider
  if (accept) {
    if (db.prepare(`SELECT 1 FROM consumer_orders WHERE rider_id = ? AND dispatch_stage IN ${BUSY_STAGES}`).get(userId)) {
      throw new DispatchError(409, 'Finish your current order first');
    }
    closeOffer(offer.id, 'accepted', now);
    db.prepare('UPDATE users SET missed_offer_streak = 0 WHERE id = ?').run(userId);
    setStage(order.id, { dispatch_stage: 'rider_assigned', rider_id: userId, rider_fee: order.rider_fee ?? riderFee(), pickup_code: code4() });
    const rider = db.prepare('SELECT name, vehicle_plate FROM users WHERE id = ?').get(userId);
    if (order.delivery_dealer_id) {
      sendToUser(order.delivery_dealer_id, {
        title: `${firstName(rider?.name)} is coming to pick up`,
        body: `${order.order_number}${rider?.vehicle_plate ? ` · ${rider.vehicle_plate}` : ''}. Have it packed and ready.`,
        data: { type: 'rider_assigned', order_id: String(order.id) },
        channelId: 'orders_info',
      }).catch(() => {});
    }
    emit(order);
    log(order, `rider ${userId} accepted`);
    return order.id;
  }
  closeOffer(offer.id, 'skipped', now);
  await missed(userId, now);
  await offerNextRider(getOrder(order.id), now);
  return null;
}

function notifyConsumer(order, title, body, data = {}) {
  try {
    createNotification('consumer', order.consumer_id, title, body, { orderNumber: order.order_number, ...data });
  } catch (err) {
    console.error('[dispatch] consumer notification failed:', err.message);
  }
}

/* ── The ticker ────────────────────────────────────────────────────────── */

let ticking = false;

async function tick(now = Date.now()) {
  if (!isEnabled() || ticking) return;
  ticking = true;
  try {
    // 1. Newly paid orders.
    const fresh = db.prepare(`
      SELECT * FROM consumer_orders
      WHERE payment_status = 'paid' AND dispatch_stage IS NULL AND delivery_status = 'pending'
        AND status NOT IN ('cancelled') AND created_at >= ?
    `).all(enabledSince().replace('T', ' ').replace(/\.\d+Z$/, ''));
    for (const o of fresh) await start(o, now);

    // 2. Shops that have just opened.
    const waiting = db.prepare(`SELECT * FROM consumer_orders WHERE dispatch_stage = 'awaiting_hours'`).all();
    for (const o of waiting) {
      if (toDate(o.dispatch_started_at) <= now) {
        const trader = db.prepare('SELECT * FROM users WHERE id = ?').get(o.delivery_dealer_id);
        if (trader) await offerTrader(o, trader, now);
      }
    }

    // 3. Next-day retries after a failed delivery.
    const retries = db.prepare(`SELECT * FROM consumer_orders WHERE dispatch_stage = 'retry_wait' AND retry_on IS NOT NULL`).all();
    for (const o of retries) {
      if (toDate(o.retry_on) <= now) {
        setStage(o.id, { retry_on: null, rider_id: null, pickup_code: null, return_code: null, escalated_at: null, admin_alerted_at: null });
        await start(getOrder(o.id), now);
      }
    }

    // 4. Open offers: closed elsewhere, expired, or due a re-ring.
    const offers = db.prepare('SELECT * FROM dispatch_offers WHERE response IS NULL').all();
    for (const offer of offers) {
      const o = getOrder(offer.order_id);
      if (offer.kind === 'trader') {
        // Accepted on the website (its accept moves pending → accepted), or admin took over.
        const webAccepted = o.dispatch_stage === 'trader_offer' && o.delivery_status === 'accepted';
        if (o.dispatch_stage !== 'trader_offer' || webAccepted || o.admin_taken_over_at) {
          closeOffer(offer.id, webAccepted && o.delivery_dealer_id === offer.user_id ? 'accepted' : 'withdrawn', now);
          if (webAccepted) setStage(o.id, { dispatch_stage: 'trader_accepted' });
          if (o.admin_taken_over_at && o.dispatch_stage === 'trader_offer') setStage(o.id, { dispatch_stage: 'admin' });
          continue;
        }
      }
      if (offer.kind === 'rider' && o.dispatch_stage !== 'rider_search') {
        closeOffer(offer.id, 'withdrawn', now);
        continue;
      }
      if (toDate(offer.expires_at) <= now) {
        if (offer.kind === 'trader') {
          await escalate(o, 'timeout', now);
        } else {
          closeOffer(offer.id, 'expired', now);
          await missed(offer.user_id, now);
          await offerNextRider(getOrder(o.id), now);
        }
      } else if (now - toDate(offer.last_alert_at || offer.offered_at) >= REALERT_MS) {
        await ring(offer, now, true);
      }
    }

    // 5. Searching orders: ask the next rider; alert admin after 30 minutes.
    const searching = db.prepare(`SELECT * FROM consumer_orders WHERE dispatch_stage = 'rider_search'`).all();
    for (const o of searching) {
      await offerNextRider(o, now);
      if (!o.admin_alerted_at && o.escalated_at && now - toDate(o.escalated_at) >= ADMIN_ALERT_MS) {
        await alertAdmin(o, 'No rider has taken this order for 30 minutes', now);
      }
    }
  } catch (err) {
    console.error('[dispatch] tick failed:', err);
  } finally {
    ticking = false;
  }
}

/** Kicks the ticker right after a payment so the first ring doesn't wait up to 30 s. */
function kick() {
  setImmediate(() => tick().catch(() => {}));
}

module.exports = {
  tick, kick, respond, start, escalate, offerNextRider, eligibleRiders,
  orderCard, spokenSummary, orderLines, areaOf, firstName, positionOf, shopOf, toDate, iso, code4,
  riderFee, traderShare, isEnabled, DispatchError,
  OFFER_MS, REALERT_MS, ADMIN_ALERT_MS, MISS_LIMIT,
};
