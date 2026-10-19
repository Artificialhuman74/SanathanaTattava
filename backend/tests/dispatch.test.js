/**
 * Dispatch tests — services/dispatch.js + /api/partner/orders (ST Partner app)
 *
 * The ticker runs on a fake clock (tick(now)): trader window and re-rings, escalation to
 * riders on decline/timeout, nearest rider first, skip → next, 3 misses → offline, shop
 * hours, non-delivering shops, admin alert. Then the delivery itself over HTTP: pack,
 * pickup code, customer code + door photo, money split, failure → return → retry.
 */
const request = require('supertest');
const sharp   = require('sharp');
const db      = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createTrader, createConsumer, createProduct, createConsumerOrder, tokenFor, authHeader,
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

// Only Date is faked: the routes (real Date.now) and the ticker see the same clock,
// while supertest's timers stay real.
const at = (t) => { jest.setSystemTime(t); return dispatch.tick(t); };

beforeEach(() => {
  jest.useFakeTimers({ now: NOON, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
  clearAll();
  mockData.mockClear();
  mockNotify.mockClear();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('partner_dispatch_enabled', '1')`).run();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('partner_dispatch_enabled_at', '2000-01-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('rider_fee_per_delivery', '45')`).run();
});

let shops = 0;
function shop(overrides = {}) {
  shops += 1;
  // The clock is frozen, so the factory's time-based email/code need our help to stay unique.
  const t = createTrader({ email: `shop-${shops}@test.com`, referral_code: `S${String(shops).padStart(5, '0')}` });
  db.prepare(`UPDATE users SET latitude = ?, longitude = ?, will_deliver = ?, address = '14, 9th Block Market, Jayanagar' WHERE id = ?`)
    .run(SHOP.lat, SHOP.lng, overrides.willDeliver === false ? 0 : 1, t.user.id);
  return { id: t.user.id, headers: t.headers };
}

/** An approved rider, online, [km] east of the shop. */
function rider(km, { online = true } = {}) {
  const lng = SHOP.lng + km / 109; // ~1 km per 1/109° of longitude here
  const id = db.prepare(`
    INSERT INTO users (name, email, password, role, phone, status, review_status, partner_online, vehicle_plate)
    VALUES ('Ravi Kumar', ?, 'x', 'rider', '9876543210', 'active', 'approved', ?, 'KA05AB1234')
  `).run(`rider-${Math.random()}@test.com`, online ? 1 : 0).lastInsertRowid;
  db.prepare(`INSERT INTO user_addresses (user_id, label, address, latitude, longitude, is_default) VALUES (?, 'home', 'Somewhere', ?, ?, 1)`).run(id, SHOP.lat, lng);
  return { id, headers: authHeader(tokenFor(id, 'rider')) };
}

function order(shopId, { stock = 10, commission = 124 } = {}) {
  const { consumer } = createConsumer({ linked_dealer_id: shopId, name: 'Lakshmi Devi' });
  const product = createProduct({ name: 'Groundnut oil', unit: 'litre' });
  db.prepare(`UPDATE products SET container_type = '5L' WHERE id = ?`).run(product.id);
  const o = createConsumerOrder(consumer.id, {
    linked_dealer_id: shopId, delivery_dealer_id: shopId, status: 'confirmed',
    delivery_address: '12, 3rd Cross, Jayanagar 4th Block, Bengaluru 560011',
  });
  db.prepare(`UPDATE consumer_orders SET delivery_latitude = 12.93, delivery_longitude = 77.58 WHERE id = ?`).run(o.id);
  db.prepare(`INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, is_refill) VALUES (?, ?, 2, 100, 200, 1)`).run(o.id, product.id);
  db.prepare(`INSERT INTO dealer_inventory (dealer_id, product_id, quantity) VALUES (?, ?, ?)`).run(shopId, product.id, stock);
  db.prepare(`INSERT INTO commissions (trader_id, consumer_order_id, amount, rate, type, status) VALUES (?, ?, ?, 10, 'direct', 'pending')`).run(shopId, o.id, commission);
  return o;
}

const get = (id) => db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(id);
const openOffers = (orderId) => db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? AND response IS NULL').all(orderId);
const offersTo = (userId) => mockData.mock.calls.filter(([u, d]) => u === userId && d.type === 'order_offer');

describe('trader window', () => {
  test('nothing happens while dispatch is switched off', async () => {
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'partner_dispatch_enabled'`).run();
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    expect(get(o.id).dispatch_stage).toBeNull();
  });

  test('a paid order rings its shop, re-rings every 2 minutes, then goes to the nearest rider at 20', async () => {
    const s = shop();
    const near = rider(1);
    rider(4);
    const o = order(s.id);

    await at(NOON);
    expect(get(o.id).dispatch_stage).toBe('trader_offer');
    expect(offersTo(s.id)).toHaveLength(1);
    expect(offersTo(s.id)[0][1]).toMatchObject({ role: 'trader', reminder: '0' });
    expect(offersTo(s.id)[0][1].summary).toMatch(/2 × 5L Groundnut oil \(refill\) for Lakshmi, Jayanagar 4th Block/);

    await at(NOON + 1 * MIN);
    expect(offersTo(s.id)).toHaveLength(1);
    await at(NOON + 2 * MIN);
    expect(offersTo(s.id)).toHaveLength(2);
    expect(offersTo(s.id)[1][1].reminder).toBe('1');

    await at(NOON + 20 * MIN);
    const after = get(o.id);
    expect(after).toMatchObject({ dispatch_stage: 'rider_search', escalation_reason: 'timeout', rider_fee: 45 });
    expect(mockNotify.mock.calls.some(([u, m]) => u === s.id && m.data.type === 'pack_request')).toBe(true);
    expect(openOffers(o.id)).toEqual([expect.objectContaining({ kind: 'rider', user_id: near.id })]);
  });

  test('accepting in the app makes the shop the deliverer', async () => {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    const [offer] = openOffers(o.id);
    const res = await request(app).post(`/api/partner/orders/offers/${offer.id}/accept`).set(s.headers);
    expect(res.status).toBe(200);
    expect(get(o.id)).toMatchObject({ dispatch_stage: 'trader_accepted', delivery_status: 'accepted', delivery_dealer_id: s.id });
  });

  test('accepting on the website closes the app offer', async () => {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    db.prepare(`UPDATE consumer_orders SET delivery_status = 'accepted' WHERE id = ?`).run(o.id);
    await at(NOON + MIN);
    expect(openOffers(o.id)).toHaveLength(0);
    expect(get(o.id).dispatch_stage).toBe('trader_accepted');
  });

  test('outside shop hours the order waits, then rings when they open', async () => {
    const s = shop();
    const o = order(s.id);
    const night = Date.UTC(2026, 9, 19, 17, 30); // 11 PM IST
    await at(night);
    expect(get(o.id).dispatch_stage).toBe('awaiting_hours');
    expect(offersTo(s.id)).toHaveLength(0);
    const eightAm = Date.UTC(2026, 9, 20, 2, 30); // Tue 8 AM IST
    await at(eightAm);
    expect(get(o.id).dispatch_stage).toBe('trader_offer');
    expect(dispatch.toDate(openOffers(o.id)[0].expires_at).getTime()).toBe(eightAm + 20 * MIN);
  });

  test('a shop that doesn’t deliver only packs; riders are asked straight away', async () => {
    const s = shop({ willDeliver: false });
    const r = rider(2);
    const o = order(s.id);
    await at(NOON);
    expect(get(o.id)).toMatchObject({ dispatch_stage: 'rider_search', escalation_reason: 'non_delivering_trader' });
    expect(offersTo(r.id)).toHaveLength(1);
  });
});

describe('riders', () => {
  async function escalated() {
    const s = shop();
    const o = order(s.id);
    await at(NOON);
    const [offer] = openOffers(o.id);
    await request(app).post(`/api/partner/orders/offers/${offer.id}/decline`).set(s.headers).expect(200);
    return { s, o };
  }

  test('skip goes to the next nearest; offline and far riders are never asked', async () => {
    const a = rider(1);
    const b = rider(3);
    rider(2, { online: false });
    rider(25);
    const { o } = await escalated();
    expect(get(o.id).escalation_reason).toBe('declined');
    expect(openOffers(o.id)[0].user_id).toBe(a.id);
    const offer = openOffers(o.id)[0];
    await request(app).post(`/api/partner/orders/offers/${offer.id}/decline`).set(a.headers).expect(200);
    expect(openOffers(o.id)[0].user_id).toBe(b.id);
  });

  test('three missed offers in a row set a rider offline', async () => {
    const r = rider(1);
    for (let i = 0; i < 3; i++) {
      const s = shop();
      const o = order(s.id);
      await at(NOON);
      const [offer] = openOffers(o.id);
      await request(app).post(`/api/partner/orders/offers/${offer.id}/decline`).set(s.headers);
      expect(openOffers(o.id)[0].user_id).toBe(r.id);
      await at(NOON + 20 * MIN + i);
      db.prepare(`UPDATE consumer_orders SET dispatch_stage = 'admin' WHERE id = ?`).run(o.id);
    }
    const u = db.prepare('SELECT partner_online, auto_offline_at FROM users WHERE id = ?').get(r.id);
    expect(u.partner_online).toBe(0);
    expect(u.auto_offline_at).toBeTruthy();
    expect(mockData.mock.calls.some(([u2, d]) => u2 === r.id && d.type === 'auto_offline')).toBe(true);
  });

  test('admin is alerted when nobody takes it for 30 minutes', async () => {
    const { o } = await escalated();
    await at(NOON + 29 * MIN);
    expect(get(o.id).admin_alerted_at).toBeNull();
    await at(NOON + 31 * MIN);
    expect(get(o.id).admin_alerted_at).toBeTruthy();
  });
});

describe('delivering', () => {
  const photo = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer();

  async function riderOrder(opts) {
    const s = shop();
    const r = rider(1);
    const o = order(s.id, opts);
    await at(NOON);
    await request(app).post(`/api/partner/orders/offers/${openOffers(o.id)[0].id}/decline`).set(s.headers);
    const res = await request(app).post(`/api/partner/orders/offers/${openOffers(o.id)[0].id}/accept`).set(r.headers);
    expect(res.body.order_id).toBe(o.id);
    return { s, r, o };
  }

  test('pack → pickup code → customer code + door photo → rider paid out of the trader’s commission', async () => {
    const { s, r, o } = await riderOrder();
    const riderView = (await request(app).get(`/api/partner/orders/${o.id}`).set(r.headers)).body;
    expect(riderView).toMatchObject({ role: 'rider', stage: 'rider_assigned', earn: 45 });
    expect(riderView.pickup_code).toMatch(/^\d{4}$/);
    const shopView = (await request(app).get(`/api/partner/orders/${o.id}`).set(s.headers)).body;
    expect(shopView.role).toBe('packer');
    expect(shopView.pickup_code).toBeUndefined();
    expect(shopView.rider).toMatchObject({ first_name: 'Ravi', vehicle_plate: 'KA05AB1234' });
    expect(shopView.share_amount).toBe(79); // ₹124 commission − ₹45 rider fee

    await request(app).post(`/api/partner/orders/${o.id}/packed`).set(s.headers).expect(200);
    // "I'm at the shop" tells the shop; only the rider can say it.
    await request(app).post(`/api/partner/orders/${o.id}/at-shop`).set(s.headers).expect(403);
    await request(app).post(`/api/partner/orders/${o.id}/at-shop`).set(r.headers).expect(200);
    expect(mockNotify).toHaveBeenCalledWith(s.id, expect.objectContaining({ title: 'Ravi is at your shop' }));
    await request(app).post(`/api/partner/orders/${o.id}/handover`).set(s.headers).send({ code: '0000' }).expect(400);
    await request(app).post(`/api/partner/orders/${o.id}/handover`).set(s.headers).send({ code: riderView.pickup_code }).expect(200);
    expect(get(o.id)).toMatchObject({ dispatch_stage: 'picked_up', delivery_status: 'out_for_delivery' });

    const phone = await request(app).get(`/api/partner/orders/${o.id}/customer-phone`).set(r.headers);
    expect(phone.status).toBe(200);
    expect(phone.headers['cache-control']).toMatch(/no-store/);

    const otp = get(o.id).delivery_otp;
    await request(app).post(`/api/partner/orders/${o.id}/check-code`).set(r.headers).send({ otp: '000000' }).expect(400);
    await request(app).post(`/api/partner/orders/${o.id}/check-code`).set(r.headers).send({ otp }).expect(200);
    await request(app).post(`/api/partner/orders/${o.id}/deliver`).set(r.headers).field('otp', otp).expect(400); // no photo
    const done = await request(app).post(`/api/partner/orders/${o.id}/deliver`).set(r.headers)
      .field('otp', otp).attach('photo', await photo(), { filename: 'door.png', contentType: 'image/png' });
    expect(done.status).toBe(200);
    expect(done.body.earned).toBe(45);
    expect(get(o.id)).toMatchObject({ dispatch_stage: 'delivered', delivery_status: 'delivered' });
    expect(get(o.id).door_photo_url).toBeTruthy();
    const fee = db.prepare(`SELECT * FROM commissions WHERE consumer_order_id = ? AND type = 'delivery_fee'`).get(o.id);
    expect(fee).toMatchObject({ trader_id: r.id, amount: 45, status: 'pending' });
    const direct = db.prepare(`SELECT * FROM commissions WHERE consumer_order_id = ? AND type = 'direct'`).get(o.id);
    expect(direct).toMatchObject({ amount: 79, original_amount: 124 });

    const after = await request(app).get(`/api/partner/orders/${o.id}/customer-phone`).set(r.headers);
    expect(after.status).toBe(403);
  });

  test('a commission smaller than the rider fee all goes to the rider, never more', async () => {
    const { s, r, o } = await riderOrder({ commission: 20 });
    const riderView = (await request(app).get(`/api/partner/orders/${o.id}`).set(r.headers)).body;
    expect(riderView.earn).toBe(20);
    expect((await request(app).get(`/api/partner/orders/${o.id}`).set(s.headers)).body.share_amount).toBe(0);
    await request(app).post(`/api/partner/orders/${o.id}/packed`).set(s.headers).expect(200);
    await request(app).post(`/api/partner/orders/${o.id}/handover`).set(s.headers).send({ code: riderView.pickup_code }).expect(200);
    const done = await request(app).post(`/api/partner/orders/${o.id}/deliver`).set(r.headers)
      .field('otp', get(o.id).delivery_otp).attach('photo', await photo(), { filename: 'door.png', contentType: 'image/png' });
    expect(done.body.earned).toBe(20);
    expect(db.prepare(`SELECT amount FROM commissions WHERE consumer_order_id = ? AND type = 'delivery_fee'`).get(o.id).amount).toBe(20);
    expect(db.prepare(`SELECT amount, original_amount FROM commissions WHERE consumer_order_id = ? AND type = 'direct'`).get(o.id))
      .toMatchObject({ amount: 0, original_amount: 20 });
  });

  test('failed delivery: rider brings it back with a code, and it’s offered again from tomorrow', async () => {
    const { s, r, o } = await riderOrder();
    const code = (await request(app).get(`/api/partner/orders/${o.id}`).set(r.headers)).body.pickup_code;
    await request(app).post(`/api/partner/orders/${o.id}/packed`).set(s.headers);
    await request(app).post(`/api/partner/orders/${o.id}/handover`).set(s.headers).send({ code });
    await request(app).post(`/api/partner/orders/${o.id}/fail`).set(r.headers).send({ reason: 'not_home' }).expect(200);
    const back = (await request(app).get(`/api/partner/orders/${o.id}`).set(r.headers)).body;
    expect(back.stage).toBe('returning');
    await request(app).post(`/api/partner/orders/${o.id}/returned`).set(s.headers).send({ code: back.return_code }).expect(200);
    const waiting = get(o.id);
    expect(waiting).toMatchObject({ dispatch_stage: 'retry_wait', delivery_status: 'packed', rider_id: null, attempt_count: 1 });
    await at(dispatch.toDate(waiting.retry_on).getTime());
    expect(get(o.id).dispatch_stage).toBe('trader_offer');
  });

  test('only the people on the order can see it', async () => {
    const { o } = await riderOrder();
    const stranger = rider(2);
    expect((await request(app).get(`/api/partner/orders/${o.id}`).set(stranger.headers)).status).toBe(403);
  });
});

afterAll(() => jest.useRealTimers());
