/**
 * Admin dispatch tests — routes/adminDispatch.js (ST Partner app, handoff §4.14)
 *
 * Live fleet (stages, counts, urgent alerts), the three answers to an urgent alert
 * (take over, ask the shop, keep searching), and admin editing a shop's delivery hours.
 */
const request = require('supertest');
const db      = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createAdmin, createTrader, createConsumer, createProduct, createConsumerOrder, tokenFor, authHeader,
} = require('./helpers/factory');

const mockData = jest.fn(async () => ({ sent: 1, failed: 0 }));
const mockNotify = jest.fn(async () => ({ sent: 1, failed: 0 }));
jest.mock('../src/services/pushService', () => ({
  sendDataToUser: (...a) => mockData(...a),
  sendToUser: (...a) => mockNotify(...a),
}));

const dispatch = require('../src/services/dispatch');

const app = createApp();
// Monday 19 Oct 2026, 12:00 IST — inside the default 8 AM–8 PM hours.
const NOON = Date.UTC(2026, 9, 19, 6, 30);
const MIN = 60_000;
const SHOP = { lat: 12.925, lng: 77.593 };

const at = (t) => { jest.setSystemTime(t); return dispatch.tick(t); };

let admin;
beforeEach(() => {
  jest.useFakeTimers({ now: NOON, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
  clearAll();
  mockData.mockClear();
  mockNotify.mockClear();
  for (const [k, v] of [['partner_dispatch_enabled', '1'], ['partner_dispatch_enabled_at', '2000-01-01T00:00:00.000Z'], ['rider_fee_per_delivery', '45'], ['trader_share_on_rider_orders', '70']]) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }
  admin = createAdmin({ email: `admin-${Math.random()}@test.com` });
});

afterEach(() => jest.useRealTimers());

let shops = 0;
function shop(overrides = {}) {
  shops += 1;
  const t = createTrader({ email: `ashop-${shops}@test.com`, referral_code: `A${String(shops).padStart(5, '0')}`, name: overrides.name || 'Ganesh Stores' });
  db.prepare(`UPDATE users SET latitude = ?, longitude = ?, will_deliver = ?, address = '14, 9th Block Market, Jayanagar' WHERE id = ?`)
    .run(SHOP.lat, SHOP.lng, overrides.willDeliver === false ? 0 : 1, t.user.id);
  return { id: t.user.id, headers: t.headers };
}

function rider(km) {
  const lng = SHOP.lng + km / 109;
  const id = db.prepare(`
    INSERT INTO users (name, email, password, role, phone, status, review_status, partner_online, vehicle_plate, vehicle_type)
    VALUES ('Ravi Kumar', ?, 'x', 'rider', '9876543210', 'active', 'approved', 1, 'KA05AB1234', 'scooter')
  `).run(`arider-${Math.random()}@test.com`).lastInsertRowid;
  db.prepare(`INSERT INTO user_addresses (user_id, label, address, latitude, longitude, is_default) VALUES (?, 'home', 'Somewhere', ?, ?, 1)`).run(id, SHOP.lat, lng);
  return { id, headers: authHeader(tokenFor(id, 'rider')) };
}

function order(shopId) {
  const { consumer } = createConsumer({ linked_dealer_id: shopId, name: 'Meena Rao' });
  const product = createProduct({ name: 'Groundnut oil', unit: 'litre' });
  const o = createConsumerOrder(consumer.id, {
    linked_dealer_id: shopId, delivery_dealer_id: shopId, status: 'confirmed',
    delivery_address: '7, 2nd Main, Jayanagar 9th Block, Bengaluru 560069',
  });
  db.prepare(`UPDATE consumer_orders SET delivery_latitude = 12.92, delivery_longitude = 77.59 WHERE id = ?`).run(o.id);
  db.prepare(`INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?, ?, 1, 100, 100)`).run(o.id, product.id);
  return o;
}

const get = (id) => db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(id);
const openOffers = (orderId) => db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? AND response IS NULL').all(orderId);
const fleet = () => request(app).get('/api/admin/dispatch/fleet').set(admin.headers);

/**
 * A non-delivering shop's order that has been searching for a rider for 30 minutes.
 * withRider: a rider comes online at minute 15, so their 20-minute offer is still open at 30.
 */
async function lateOrder({ withRider = false } = {}) {
  const s = shop({ willDeliver: false });
  const o = order(s.id);
  await at(NOON);
  const r = withRider ? rider(5) : null;
  await at(NOON + 15 * MIN);
  await at(NOON + 30 * MIN);
  return { s, o, r };
}

describe('live fleet', () => {
  test('admins only', async () => {
    const s = shop();
    const res = await request(app).get('/api/admin/dispatch/fleet').set(s.headers);
    expect(res.status).toBe(403);
  });

  test('shows each order with its stage, who has it and how long', async () => {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    jest.setSystemTime(NOON + 6 * MIN);
    const res = await fleet();
    expect(res.status).toBe(200);
    const row = res.body.orders.find((r) => r.id === o.id);
    expect(row).toMatchObject({
      stage: 'trader_offer', stage_key: 'deciding', stage_label: 'Trader deciding · 14 min left',
      who: 'Ganesh Stores', area: 'Jayanagar 9th Block', customer: 'Meena', minutes_in_stage: 6, attention: false, alert: false,
    });
    expect(res.body.counts).toMatchObject({ deciding: 1, finding: 0 });
  });

  test('a shop about to run out of time needs attention', async () => {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    jest.setSystemTime(NOON + 16 * MIN);
    const row = (await fleet()).body.orders.find((r) => r.id === o.id);
    expect(row).toMatchObject({ stage_label: 'Trader deciding · 4 min left', attention: true });
  });

  test('an order waiting for shop hours says when it opens', async () => {
    const s = shop();
    jest.setSystemTime(Date.UTC(2026, 9, 18, 14, 30)); // Sunday 8 PM IST: closed by default
    const o = order(s.id);
    await dispatch.tick(Date.UTC(2026, 9, 18, 14, 30));
    const row = (await fleet()).body.orders.find((r) => r.id === o.id);
    expect(row).toMatchObject({ stage_key: 'hours', stage_label: 'Waiting · opens 8 AM', minutes_in_stage: null });
  });

  test('no rider for 30 minutes raises an urgent alert; Keep searching hides it', async () => {
    rider(50); // online but too far away to be asked
    const { o } = await lateOrder();
    let res = await fleet();
    let row = res.body.orders.find((r) => r.id === o.id);
    expect(row).toMatchObject({ stage_key: 'late', alert: true, attention: true, can_ask_shop: true, minutes_in_stage: 30 });
    expect(res.body.counts).toMatchObject({ finding: 1, finding_late: 1, alerts: 1, riders_online: 1 });

    expect((await request(app).get('/api/admin/dispatch/badges').set(admin.headers)).body).toEqual({ fleet_alerts: 1, riders_waiting: 0 });

    const keep = await request(app).post(`/api/admin/dispatch/orders/${o.id}/keep-searching`).set(admin.headers);
    expect(keep.status).toBe(200);
    row = (await fleet()).body.orders.find((r) => r.id === o.id);
    expect(row).toMatchObject({ alert: false, stage: 'rider_search' });
    expect((await request(app).get('/api/admin/dispatch/badges').set(admin.headers)).body.fleet_alerts).toBe(0);
  });

  test('Keep searching on an order with no alert is a 404', async () => {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    const res = await request(app).post(`/api/admin/dispatch/orders/${o.id}/keep-searching`).set(admin.headers);
    expect(res.status).toBe(404);
  });

  test('a rider on the way shows with their live position', async () => {
    const s = shop({ willDeliver: false });
    const r = rider(1);
    const o = order(s.id);
    await at(NOON);
    const [offer] = openOffers(o.id);
    await request(app).post(`/api/partner/orders/offers/${offer.id}/accept`).set(r.headers);
    db.prepare('UPDATE users SET live_lat = 12.93, live_lng = 77.6, live_at = ? WHERE id = ?').run(new Date(NOON).toISOString(), r.id);
    const res = await fleet();
    const row = res.body.orders.find((x) => x.id === o.id);
    expect(row).toMatchObject({ stage_key: 'toShop', who: 'Ravi (rider)', with_rider: true });
    expect(row.rider).toMatchObject({ vehicle_plate: 'KA05AB1234', pos: { lat: 12.93, lng: 77.6 } });
    expect(res.body.partners.find((p) => p.id === r.id)).toMatchObject({ busy: true, role: 'rider' });
  });
});

describe('answering an urgent alert', () => {
  test('Take over stops the rider search for good', async () => {
    const { o, r: far } = await lateOrder({ withRider: true });
    expect(get(o.id).admin_alerted_at).not.toBeNull();
    expect(openOffers(o.id)).toEqual([expect.objectContaining({ user_id: far.id })]);

    const res = await request(app).post(`/api/delivery/orders/${o.id}/takeover`).set(admin.headers);
    expect(res.status).toBe(200);
    await at(NOON + 31 * MIN);
    expect(get(o.id).dispatch_stage).toBe('admin');
    expect(openOffers(o.id)).toHaveLength(0);

    const rings = mockData.mock.calls.length;
    rider(1);
    await at(NOON + 40 * MIN);
    expect(mockData.mock.calls.length).toBe(rings);
    const row = (await fleet()).body.orders.find((r) => r.id === o.id);
    expect(row).toMatchObject({ stage_label: 'With admin', who: 'Admin', alert: false });
  });

  test('Ask the shop rings them again with a fresh 20 minutes, without counting a miss against the rider', async () => {
    const { s, o, r } = await lateOrder({ withRider: true });
    expect(openOffers(o.id)).toEqual([expect.objectContaining({ user_id: r.id })]);
    mockData.mockClear();

    const res = await request(app).post(`/api/admin/dispatch/orders/${o.id}/ask-shop`).set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('trader_offer');
    expect(get(o.id)).toMatchObject({ dispatch_stage: 'trader_offer', admin_alerted_at: null, escalated_at: null });
    expect(openOffers(o.id)).toEqual([expect.objectContaining({ kind: 'trader', user_id: s.id })]);
    expect(mockData.mock.calls.some(([u, d]) => u === s.id && d.type === 'order_offer')).toBe(true);
    expect(db.prepare('SELECT missed_offer_streak FROM users WHERE id = ?').get(r.id).missed_offer_streak).toBe(0);
    expect(db.prepare(`SELECT response FROM dispatch_offers WHERE order_id = ? AND user_id = ?`).get(o.id, r.id).response).toBe('withdrawn');
  });

  test('if the shop says no again, riders are asked and the 30-minute alert starts over', async () => {
    rider(50);
    const { s, o } = await lateOrder();
    await request(app).post(`/api/admin/dispatch/orders/${o.id}/ask-shop`).set(admin.headers);
    const [offer] = openOffers(o.id);
    jest.setSystemTime(NOON + 35 * MIN);
    await request(app).post(`/api/partner/orders/offers/${offer.id}/decline`).set(s.headers);
    expect(get(o.id)).toMatchObject({ dispatch_stage: 'rider_search', admin_alerted_at: null });

    await at(NOON + 64 * MIN);
    expect(get(o.id).admin_alerted_at).toBeNull();
    await at(NOON + 65 * MIN);
    expect(get(o.id).admin_alerted_at).not.toBeNull();
  });

  test('Ask the shop only works while a rider is being searched for', async () => {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    const res = await request(app).post(`/api/admin/dispatch/orders/${o.id}/ask-shop`).set(admin.headers);
    expect(res.status).toBe(409);
  });
});

describe('delivery hours (admin)', () => {
  const week = (fn) => Array.from({ length: 7 }, (_, i) => fn(i));

  test('shows the defaults as one line before the shop has saved anything', async () => {
    const s = shop();
    const res = await request(app).get(`/api/admin/dispatch/hours/${s.id}`).set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: false, summary: 'Mon–Fri 8 AM–8 PM · Sat 9 AM–6 PM', shop: { id: s.id, name: 'Ganesh Stores' } });
    expect(res.body.days).toHaveLength(7);
  });

  test('admin saves a shop’s week; the list and the shop’s own app see it', async () => {
    const s = shop();
    const days = week((i) => ({ enabled: i < 6, start: 480, end: 1200 }));
    const res = await request(app).put(`/api/admin/dispatch/hours/${s.id}`).set(admin.headers).send({ days });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: true, summary: 'Mon–Sat 8 AM–8 PM', updated_by_name: 'Test Admin', updated_by_role: 'admin' });
    expect(mockNotify).not.toHaveBeenCalled();

    const list = await request(app).get('/api/admin/dispatch/hours').set(admin.headers);
    expect(list.body.hours[s.id]).toEqual({ summary: 'Mon–Sat 8 AM–8 PM', saved: true });

    const mine = await request(app).get('/api/partner/hours').set(s.headers);
    expect(mine.body.days[6].enabled).toBe(false);
  });

  test('“Tell the shop” sends them a notification', async () => {
    const s = shop();
    const days = week(() => ({ enabled: true, start: 540, end: 1080 }));
    await request(app).put(`/api/admin/dispatch/hours/${s.id}`).set(admin.headers).send({ days, notify: true });
    expect(mockNotify).toHaveBeenCalledWith(s.id, expect.objectContaining({
      title: 'Your delivery hours changed',
      body: 'Our team updated them: Every day 9 AM–6 PM.',
    }));
  });

  test('bad hours are refused', async () => {
    const s = shop();
    const days = week(() => ({ enabled: true, start: 300, end: 1200 }));
    const res = await request(app).put(`/api/admin/dispatch/hours/${s.id}`).set(admin.headers).send({ days });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 AM and 10 PM/);
  });

  test('only shops have hours, and only admins edit them here', async () => {
    const r = rider(1);
    expect((await request(app).get(`/api/admin/dispatch/hours/${r.id}`).set(admin.headers)).status).toBe(404);
    const s = shop();
    expect((await request(app).get(`/api/admin/dispatch/hours/${s.id}`).set(s.headers)).status).toBe(403);
  });
});
