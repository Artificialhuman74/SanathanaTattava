/**
 * Admin side of ST Partner dispatch (handoff §4.14).
 *
 *   GET  /api/admin/dispatch/fleet                          live orders by stage, partners online, urgent alerts
 *   GET  /api/admin/dispatch/badges                         sidebar counts: urgent alerts, riders waiting for review
 *   POST /api/admin/dispatch/orders/:id/ask-shop            stop the rider search, ring the shop again
 *   POST /api/admin/dispatch/orders/:id/keep-searching      hide the urgent alert; the search carries on
 *   GET  /api/admin/dispatch/hours                          every shop's week as one line
 *   GET  /api/admin/dispatch/hours/:userId                  one shop's week, and who last changed it
 *   PUT  /api/admin/dispatch/hours/:userId                  save it; { notify: true } tells the shop
 *
 * "Take over delivery" uses the existing POST /api/delivery/orders/:id/takeover; the
 * dispatch ticker sees admin_taken_over_at and stops ringing anyone for that order.
 */
const express = require('express');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/auditLog');
const dispatch = require('../services/dispatch');
const hours = require('../services/deliveryHours');
const { sendToUser } = require('../services/pushService');

const router = express.Router();
router.use(authenticate, requireAdmin);

const LIVE_FRESH_MS = 10 * 60_000;
const DECIDING_SOON_MIN = 5;

const minutesSince = (t, now) => (t ? Math.max(0, Math.floor((now - dispatch.toDate(t)) / 60_000)) : null);

/** When the order entered the stage it is in now (best record we keep for each stage). */
function stageSince(o, lastOffer) {
  switch (o.dispatch_stage) {
    case 'trader_offer': return lastOffer?.offered_at || o.dispatch_started_at;
    case 'rider_search': return o.escalated_at;
    case 'rider_assigned': return lastOffer?.responded_at || o.updated_at;
    case 'picked_up': return o.picked_up_at;
    default: return o.updated_at;
  }
}

/** Stage key (colours on the page), label and who has the order right now. */
function describe(o, now) {
  const shop = o.shop_name || 'No shop';
  const rider = o.rider_name ? `${dispatch.firstName(o.rider_name)} (rider)` : null;
  const late = !!o.admin_alerted_at;
  switch (o.dispatch_stage) {
    case 'awaiting_hours': {
      const opens = dispatch.toDate(o.dispatch_started_at);
      const { minutes } = hours.localClock(opens);
      return { key: 'hours', label: `Waiting · opens ${hours.clockText(minutes)}`, who: shop };
    }
    case 'trader_offer': {
      const left = Math.max(0, Math.ceil((dispatch.toDate(o.trader_offer_expires_at) - now) / 60_000));
      return { key: 'deciding', label: `Trader deciding · ${left} min left`, who: shop, minutesLeft: left };
    }
    case 'trader_accepted':
      if (o.delivery_status === 'out_for_delivery') return { key: 'out', label: 'Out for delivery', who: shop };
      if (o.delivery_status === 'packed') return { key: 'packing', label: 'Packed', who: shop };
      return { key: 'packing', label: 'Packing', who: shop };
    case 'rider_search':
      return {
        key: late ? 'late' : 'search',
        label: 'Finding a rider',
        who: `${shop}${o.delivery_status === 'packed' ? ' (packed)' : ''}`,
      };
    case 'rider_assigned': return { key: 'toShop', label: 'Rider going to shop', who: rider || shop };
    case 'picked_up': return { key: 'out', label: 'Out for delivery', who: rider || shop };
    case 'returning': return { key: 'back', label: 'Returning to shop', who: rider || shop };
    case 'retry_wait': return { key: 'hours', label: 'Tries again tomorrow', who: shop };
    case 'admin': return { key: 'late', label: o.admin_taken_over_at ? 'With admin' : 'No shop covers it', who: 'Admin' };
    default: return { key: 'hours', label: o.dispatch_stage, who: shop };
  }
}

router.get('/fleet', (req, res) => {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT co.id, co.order_number, co.dispatch_stage, co.delivery_status, co.delivery_address,
           co.delivery_latitude, co.delivery_longitude, co.dispatch_started_at, co.trader_offer_expires_at,
           co.escalated_at, co.admin_alerted_at, co.admin_alert_dismissed_at, co.admin_taken_over_at,
           co.picked_up_at, co.updated_at, co.total_amount,
           c.name AS consumer_name,
           s.id AS shop_id, s.name AS shop_name, s.latitude AS shop_lat, s.longitude AS shop_lng,
           r.id AS rider_id, r.name AS rider_name, r.vehicle_type, r.vehicle_plate,
           r.live_lat AS rider_lat, r.live_lng AS rider_lng, r.live_at AS rider_live_at
    FROM consumer_orders co
    LEFT JOIN consumers c ON c.id = co.consumer_id
    LEFT JOIN users s ON s.id = co.delivery_dealer_id
    LEFT JOIN users r ON r.id = co.rider_id
    WHERE co.dispatch_stage IS NOT NULL AND co.dispatch_stage != 'delivered'
      AND co.status NOT IN ('cancelled') AND co.delivery_status NOT IN ('delivered', 'cancelled')
    ORDER BY co.created_at DESC
    LIMIT 200
  `).all();

  const lastOffer = db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? ORDER BY id DESC LIMIT 1');
  const passed = db.prepare(`SELECT COUNT(*) AS n FROM dispatch_offers WHERE order_id = ? AND kind = 'rider' AND response IN ('skipped','expired')`);

  const orders = rows.map((o) => {
    const stage = describe(o, now);
    const since = stageSince(o, lastOffer.get(o.id));
    const riderFresh = o.rider_live_at && now - dispatch.toDate(o.rider_live_at) < LIVE_FRESH_MS;
    return {
      id: o.id,
      order_number: o.order_number,
      area: dispatch.areaOf(o.delivery_address),
      customer: dispatch.firstName(o.consumer_name),
      stage: o.dispatch_stage,
      stage_key: stage.key,
      stage_label: stage.label,
      who: stage.who,
      minutes_in_stage: o.dispatch_stage === 'awaiting_hours' ? null : minutesSince(since, now),
      attention: stage.key === 'late' || o.dispatch_stage === 'returning'
        || (o.dispatch_stage === 'trader_offer' && stage.minutesLeft <= DECIDING_SOON_MIN),
      with_rider: !!o.rider_id || o.dispatch_stage === 'rider_search',
      riders_passed: passed.get(o.id).n,
      shop: o.shop_id ? { id: o.shop_id, name: o.shop_name, lat: o.shop_lat, lng: o.shop_lng } : null,
      customer_pos: o.delivery_latitude != null ? { lat: o.delivery_latitude, lng: o.delivery_longitude } : null,
      rider: o.rider_id ? {
        id: o.rider_id, name: o.rider_name, vehicle_type: o.vehicle_type, vehicle_plate: o.vehicle_plate,
        pos: riderFresh ? { lat: o.rider_lat, lng: o.rider_lng } : null,
      } : null,
      alert: !!o.admin_alerted_at && !o.admin_alert_dismissed_at && !o.admin_taken_over_at
        && ['rider_search', 'admin'].includes(o.dispatch_stage),
      can_ask_shop: o.dispatch_stage === 'rider_search' && !!o.shop_id,
    };
  });

  const partners = db.prepare(`
    SELECT id, name, role, vehicle_type, live_lat, live_lng, live_at
    FROM users
    WHERE partner_online = 1 AND status = 'active' AND role IN ('rider', 'trader')
  `).all();
  const busy = new Set(rows.filter((o) => o.rider_id && ['rider_assigned', 'picked_up', 'returning'].includes(o.dispatch_stage)).map((o) => o.rider_id));
  const online = partners.map((p) => {
    const fresh = p.live_at && now - dispatch.toDate(p.live_at) < LIVE_FRESH_MS;
    return {
      id: p.id, name: p.name, role: p.role, vehicle_type: p.vehicle_type, busy: busy.has(p.id),
      pos: fresh ? { lat: p.live_lat, lng: p.live_lng } : null,
    };
  });

  const by = (pred) => orders.filter(pred).length;
  res.json({
    orders,
    partners: online,
    counts: {
      deciding: by((o) => o.stage === 'trader_offer'),
      finding: by((o) => o.stage === 'rider_search'),
      finding_late: by((o) => o.stage === 'rider_search' && o.stage_key === 'late'),
      out: by((o) => o.stage_key === 'out'),
      riders_online: online.filter((p) => p.role === 'rider').length,
      partners_online: online.length,
      attention: by((o) => o.attention),
      alerts: by((o) => o.alert),
    },
    dispatch_enabled: dispatch.isEnabled(),
    at: new Date(now).toISOString(),
  });
});

/** For the admin sidebar: the red dot on Fleet, the count on Riders. Cheap enough to poll. */
router.get('/badges', (req, res) => {
  const alerts = db.prepare(`
    SELECT COUNT(*) AS n FROM consumer_orders
    WHERE admin_alerted_at IS NOT NULL AND admin_alert_dismissed_at IS NULL AND admin_taken_over_at IS NULL
      AND dispatch_stage IN ('rider_search', 'admin') AND status NOT IN ('cancelled') AND delivery_status NOT IN ('delivered', 'cancelled')
  `).get().n;
  const riders = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'rider' AND review_status = 'pending_review'`).get().n;
  res.json({ fleet_alerts: alerts, riders_waiting: riders });
});

function orderIdOf(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid order id' });
    return null;
  }
  return id;
}

router.post('/orders/:id/ask-shop', auditLog('dispatch-ask-shop'), async (req, res) => {
  const id = orderIdOf(req, res);
  if (!id) return;
  try {
    const order = await dispatch.askShopToDeliver(id);
    res.json({ ok: true, stage: order.dispatch_stage });
  } catch (err) {
    if (err instanceof dispatch.DispatchError) return res.status(err.status).json({ error: err.message });
    console.error('POST /admin/dispatch/orders/:id/ask-shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/orders/:id/keep-searching', (req, res) => {
  const id = orderIdOf(req, res);
  if (!id) return;
  const r = db.prepare(`
    UPDATE consumer_orders SET admin_alert_dismissed_at = ?
    WHERE id = ? AND admin_alerted_at IS NOT NULL
  `).run(new Date().toISOString(), id);
  if (!r.changes) return res.status(404).json({ error: 'No alert on this order' });
  res.json({ ok: true });
});

/* ── Delivery hours (admin can change any shop's, handoff §4.10) ─────────── */

function shopOr404(req, res) {
  const id = Number(req.params.userId);
  const shop = Number.isInteger(id) && db.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'trader'`).get(id);
  if (!shop) {
    res.status(404).json({ error: 'Shop not found' });
    return null;
  }
  return shop;
}

function withEditor(week) {
  const by = week.updated_by && db.prepare('SELECT name, role FROM users WHERE id = ?').get(week.updated_by);
  return { ...week, summary: hours.summarize(week.days), updated_by_name: by?.name || null, updated_by_role: by?.role || null };
}

router.get('/hours', (req, res) => {
  const shops = db.prepare(`SELECT id FROM users WHERE role = 'trader'`).all();
  const out = {};
  for (const { id } of shops) {
    const week = hours.getHours(id);
    out[id] = { summary: hours.summarize(week.days), saved: week.saved };
  }
  res.json({ hours: out });
});

router.get('/hours/:userId', (req, res) => {
  const shop = shopOr404(req, res);
  if (!shop) return;
  res.json({ shop, ...withEditor(hours.getHours(shop.id)) });
});

router.put('/hours/:userId', auditLog('delivery-hours'), (req, res) => {
  const shop = shopOr404(req, res);
  if (!shop) return;
  const error = hours.setHours(shop.id, req.body?.days, req.user.id);
  if (error) return res.status(400).json({ error });
  const week = withEditor(hours.getHours(shop.id));
  if (req.body?.notify === true) {
    sendToUser(shop.id, {
      title: 'Your delivery hours changed',
      body: `Our team updated them: ${week.summary}.`,
      data: { type: 'hours_changed' },
    }).catch(() => {});
  }
  res.json({ shop, ...week });
});

module.exports = router;
