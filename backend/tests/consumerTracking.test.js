/**
 * Customer tracking tests — routes/consumerTracking.js (handoff §4.13)
 *
 * What the customer sees at each stage: waiting for shop hours, packing, a rider on the way
 * (name, vehicle, live position, call), their delivery code, and that the rider's details
 * disappear once the delivery is over. Plus the "stop ringing" push when an offer goes elsewhere.
 */
const request = require('supertest');
const db      = require('../src/database/db');
const { createApp } = require('./helpers/app');
const {
  clearAll, createTrader, createConsumer, createProduct, createConsumerOrder, tokenFor, authHeader,
} = require('./helpers/factory');

const mockData = jest.fn(async () => ({ sent: 1, failed: 0 }));
jest.mock('../src/services/pushService', () => ({
  sendDataToUser: (...a) => mockData(...a),
  sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })),
}));

const dispatch = require('../src/services/dispatch');

const app = createApp();
const NOON = Date.UTC(2026, 9, 19, 6, 30); // Monday 12:00 IST
const MIN = 60_000;
const SHOP = { lat: 12.925, lng: 77.593 };
const at = (t) => { jest.setSystemTime(t); return dispatch.tick(t); };

beforeEach(() => {
  jest.useFakeTimers({ now: NOON, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
  clearAll();
  mockData.mockClear();
  for (const [k, v] of [['partner_dispatch_enabled', '1'], ['partner_dispatch_enabled_at', '2000-01-01T00:00:00.000Z']]) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }
});
afterEach(() => jest.useRealTimers());

let n = 0;
function setup({ willDeliver = true } = {}) {
  n += 1;
  const t = createTrader({ email: `tshop-${n}@test.com`, referral_code: `T${String(n).padStart(5, '0')}`, name: 'Ganesh Stores' });
  db.prepare(`UPDATE users SET latitude = ?, longitude = ?, will_deliver = ?, phone = '9111111111' WHERE id = ?`).run(SHOP.lat, SHOP.lng, willDeliver ? 1 : 0, t.user.id);
  const c = createConsumer({ linked_dealer_id: t.user.id, name: 'Meena Rao', email: `tc-${n}@test.com` });
  const product = createProduct({ name: 'Groundnut oil', unit: 'litre' });
  const o = createConsumerOrder(c.consumer.id, { linked_dealer_id: t.user.id, delivery_dealer_id: t.user.id, status: 'confirmed' });
  db.prepare(`UPDATE consumer_orders SET delivery_latitude = 12.92, delivery_longitude = 77.59 WHERE id = ?`).run(o.id);
  db.prepare(`INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, is_refill) VALUES (?, ?, 2, 100, 200, 1)`).run(o.id, product.id);
  db.prepare(`INSERT INTO dealer_inventory (dealer_id, product_id, quantity) VALUES (?, ?, 10)`).run(t.user.id, product.id);
  return { shop: t, customer: c, order: o };
}

function rider() {
  const id = db.prepare(`
    INSERT INTO users (name, email, password, role, phone, status, review_status, partner_online, vehicle_type, vehicle_plate)
    VALUES ('Ravi Kumar', ?, 'x', 'rider', '9222222222', 'active', 'approved', 1, 'scooter', 'KA05AB1234')
  `).run(`trider-${Math.random()}@test.com`).lastInsertRowid;
  db.prepare(`INSERT INTO user_addresses (user_id, label, address, latitude, longitude, is_default) VALUES (?, 'home', 'x', ?, ?, 1)`).run(id, SHOP.lat, SHOP.lng + 0.01);
  return { id, headers: authHeader(tokenFor(id, 'rider')) };
}

const track = (s) => request(app).get(`/api/consumer/orders/${s.order.id}/tracking`).set(s.customer.headers);

test('only the customer who placed it can see it', async () => {
  const a = setup();
  const b = setup();
  const res = await request(app).get(`/api/consumer/orders/${a.order.id}/tracking`).set(b.customer.headers);
  expect(res.status).toBe(404);
});

test('outside shop hours it says when delivery starts, with no code yet', async () => {
  const s = setup();
  const sundayEvening = Date.UTC(2026, 9, 18, 14, 30); // Sunday 8 PM IST; default hours close Sunday
  jest.setSystemTime(sundayEvening);
  await dispatch.tick(sundayEvening);
  const res = await track(s);
  expect(res.body).toMatchObject({ state: 'scheduled', step: 0, headline: 'Will be delivered from 8 AM', delivery_code: null, bringer: null });
  expect(res.body.note).toMatch(/Your shop delivers 8 AM – 8 PM\. .*first in line for tomorrow morning/);
  expect(res.body.lines[0]).toMatchObject({ quantity: 2, line_type: 'refill' });
});

test('a rider picking up and bringing it: name, vehicle, live position, call, then the code', async () => {
  const s = setup({ willDeliver: false });
  const r = rider();
  await at(NOON);
  const [offer] = db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? AND response IS NULL').all(s.order.id);
  await request(app).post(`/api/partner/orders/offers/${offer.id}/accept`).set(r.headers);
  db.prepare('UPDATE users SET live_lat = 12.93, live_lng = 77.6, live_at = ? WHERE id = ?').run(new Date(NOON).toISOString(), r.id);

  let res = await track(s);
  expect(res.body).toMatchObject({
    state: 'rider_coming', headline: 'Ravi is picking up your order', can_call: true,
    bringer: { kind: 'rider', first_name: 'Ravi', vehicle: 'Scooter', plate: 'KA05AB1234', live: { lat: 12.93, lng: 77.6 } },
  });
  expect(res.body.distance_km).toBeGreaterThan(0);
  expect((await request(app).get(`/api/consumer/orders/${s.order.id}/call`).set(s.customer.headers)).body.phone).toBe('9222222222');

  // The shop packs and the rider picks up with their code: out for delivery.
  const packed = await request(app).post(`/api/partner/orders/${s.order.id}/packed`).set(s.shop.headers);
  expect(packed.body).toEqual({ ok: true });
  const code = db.prepare('SELECT pickup_code FROM consumer_orders WHERE id = ?').get(s.order.id).pickup_code;
  await request(app).post(`/api/partner/orders/${s.order.id}/handover`).set(s.shop.headers).send({ code });
  res = await track(s);
  expect(res.body).toMatchObject({ state: 'on_the_way', step: 2, headline: 'Ravi is bringing your order' });
  expect(res.body.delivery_code).toMatch(/^\d{6}$/);

  // Delivered: the rider's details are gone.
  db.prepare(`UPDATE consumer_orders SET delivery_status = 'delivered', dispatch_stage = 'delivered', status = 'delivered' WHERE id = ?`).run(s.order.id);
  res = await track(s);
  expect(res.body).toMatchObject({ state: 'delivered', step: 3, bringer: null, delivery_code: null, can_call: false });
  expect((await request(app).get(`/api/consumer/orders/${s.order.id}/call`).set(s.customer.headers)).status).toBe(403);
});

test('the customer is told when a rider takes their order', async () => {
  const s = setup({ willDeliver: false });
  const r = rider();
  await at(NOON);
  const [offer] = db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? AND response IS NULL').all(s.order.id);
  await request(app).post(`/api/partner/orders/offers/${offer.id}/accept`).set(r.headers);
  const note = db.prepare(`SELECT title FROM notifications WHERE user_type = 'consumer' AND user_id = ? ORDER BY id DESC LIMIT 1`).get(s.customer.consumer.id);
  expect(note.title).toMatch(/^Ravi is picking up your order/);
});

test('a ringing phone is told to stop when the offer runs out', async () => {
  const s = setup();
  await at(NOON);
  const [offer] = db.prepare('SELECT * FROM dispatch_offers WHERE order_id = ? AND response IS NULL').all(s.order.id);
  await at(NOON + 20 * MIN);
  expect(mockData).toHaveBeenCalledWith(s.shop.user.id, expect.objectContaining({ type: 'offer_closed', offer_id: offer.id, reason: 'expired' }));
});
