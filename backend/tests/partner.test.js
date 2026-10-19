/**
 * Partner status tests — /api/partner (ST Partner app)
 *
 * Covers: who may use it (traders, approved riders), the trader's shop becoming a
 * start place, going online from a place or from "here", live location only while
 * online, start place rules, and the test alert.
 */
const request = require('supertest');
const db      = require('../src/database/db');
const { createApp } = require('./helpers/app');
const { clearAll, createTrader, tokenFor, authHeader } = require('./helpers/factory');

const mockSend = jest.fn(async ({ tokens }) => ({
  successCount: tokens.length, failureCount: 0, responses: tokens.map(() => ({ success: true })),
}));
jest.mock('../src/services/firebaseAdmin', () => ({
  verifyIdToken: jest.fn(),
  messaging: () => ({ sendEachForMulticast: mockSend }),
}));

const app = createApp();
beforeEach(() => { clearAll(); mockSend.mockClear(); });

function createRider(review = 'approved') {
  const id = db.prepare(`
    INSERT INTO users (name, email, password, role, phone, status, review_status)
    VALUES ('Ravi Kumar', ?, 'x', 'rider', '9876543210', 'active', ?)
  `).run(`rider-${Date.now()}-${Math.random()}@test.com`, review).lastInsertRowid;
  db.prepare(`INSERT INTO user_addresses (user_id, label, address, latitude, longitude, is_default) VALUES (?, 'home', 'Jayanagar 4th Block', 12.925, 77.593, 1)`).run(id);
  return { id, headers: authHeader(tokenFor(id, 'rider')) };
}

describe('access', () => {
  test('riders still under review are kept out', async () => {
    const rider = createRider('pending_review');
    const res = await request(app).get('/api/partner/home').set(rider.headers);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/being checked/);
  });

  test('approved riders and traders get in', async () => {
    const rider = createRider('approved');
    const { headers } = createTrader();
    expect((await request(app).get('/api/partner/home').set(rider.headers)).status).toBe(200);
    expect((await request(app).get('/api/partner/home').set(headers)).status).toBe(200);
  });
});

describe('home and places', () => {
  test('a trader’s shop becomes their first start place, once', async () => {
    const { headers } = createTrader();
    const first = await request(app).get('/api/partner/home').set(headers);
    expect(first.body.places).toHaveLength(1);
    expect(first.body.places[0]).toMatchObject({ label: 'shop', is_default: true });
    expect(first.body.online).toBe(false);
    expect(first.body.today).toEqual({ deliveries: 0, earned: 0 });
    const again = await request(app).get('/api/partner/places').set(headers);
    expect(again.body.places).toHaveLength(1);
  });

  test('add, make default, and keep at least one place', async () => {
    const rider = createRider();
    const add = await request(app).post('/api/partner/places').set(rider.headers)
      .send({ label: 'shop', address: '9th Block market', lat: 12.93, lng: 77.58 });
    expect(add.status).toBe(201);
    const id = add.body.place.id;
    await request(app).post(`/api/partner/places/${id}/default`).set(rider.headers);
    const list = await request(app).get('/api/partner/places').set(rider.headers);
    expect(list.body.places[0]).toMatchObject({ id, is_default: true });
    // Riders' default place doubles as their location.
    expect(db.prepare('SELECT address FROM users WHERE id = ?').get(rider.id).address).toBe('9th Block market');

    const del = await request(app).delete(`/api/partner/places/${id}`).set(rider.headers);
    expect(del.status).toBe(200);
    const only = (await request(app).get('/api/partner/places').set(rider.headers)).body.places;
    expect(only).toHaveLength(1);
    expect(only[0].is_default).toBe(true);
    const last = await request(app).delete(`/api/partner/places/${only[0].id}`).set(rider.headers);
    expect(last.status).toBe(400);
  });

  test('bad pins are refused', async () => {
    const rider = createRider();
    const res = await request(app).post('/api/partner/places').set(rider.headers).send({ address: 'x', lat: 'a', lng: 77 });
    expect(res.status).toBe(400);
  });
});

describe('going online', () => {
  test('from a saved place, then live location updates, then offline', async () => {
    const rider = createRider();
    const place = (await request(app).get('/api/partner/places').set(rider.headers)).body.places[0];
    const on = await request(app).put('/api/partner/online').set(rider.headers).send({ online: true, place_id: place.id });
    expect(on.body).toEqual({ online: true, place_id: place.id });

    const home = await request(app).get('/api/partner/home').set(rider.headers);
    expect(home.body.online).toBe(true);
    expect(home.body.started_from).toMatchObject({ kind: 'place', place: { id: place.id } });

    const ping = await request(app).post('/api/partner/location').set(rider.headers).send({ lat: 12.93, lng: 77.6 });
    expect(ping.status).toBe(200);
    expect(db.prepare('SELECT live_lng FROM users WHERE id = ?').get(rider.id).live_lng).toBe(77.6);

    await request(app).put('/api/partner/online').set(rider.headers).send({ online: false });
    const late = await request(app).post('/api/partner/location').set(rider.headers).send({ lat: 12.93, lng: 77.6 });
    expect(late.status).toBe(409);
  });

  test('from where they are now', async () => {
    const rider = createRider();
    const on = await request(app).put('/api/partner/online').set(rider.headers).send({ online: true, lat: 12.97, lng: 77.59 });
    expect(on.body.place_id).toBeNull();
    const home = await request(app).get('/api/partner/home').set(rider.headers);
    expect(home.body.started_from).toEqual({ kind: 'live' });
  });

  test('needs a place or a location', async () => {
    const rider = createRider();
    const res = await request(app).put('/api/partner/online').set(rider.headers).send({ online: true });
    expect(res.status).toBe(400);
  });

  test('cannot go online from someone else’s place', async () => {
    const a = createRider();
    const b = createRider();
    const theirs = (await request(app).get('/api/partner/places').set(b.headers)).body.places[0];
    const res = await request(app).put('/api/partner/online').set(a.headers).send({ online: true, place_id: theirs.id });
    expect(res.status).toBe(404);
  });
});

describe('test alert', () => {
  test('rings the partner’s own phones with a data message', async () => {
    const rider = createRider();
    await request(app).post('/api/devices').set(rider.headers).send({ token: 'fcm-token-rider-phone-0123456789' });
    const res = await request(app).post('/api/partner/test-alert').set(rider.headers);
    expect(res.status).toBe(200);
    const msg = mockSend.mock.calls[0][0];
    expect(msg.notification).toBeUndefined();
    expect(msg.data).toMatchObject({ type: 'order_offer', test: '1', role: 'rider' });
    expect(msg.android.priority).toBe('high');
  });

  test('explains when the phone isn’t registered', async () => {
    const rider = createRider();
    const res = await request(app).post('/api/partner/test-alert').set(rider.headers);
    expect(res.status).toBe(409);
  });
});

describe('earnings and payout', () => {
  test('earnings list the last 7 days with totals and the bank tail', async () => {
    const { user: { id }, headers } = createTrader();
    db.prepare(`UPDATE users SET bank_account_number = '50100012344821', bank_ifsc = 'HDFC0001234' WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO commissions (trader_id, amount, rate, type, status, created_at) VALUES (?, 45, 10, 'direct', 'paid', datetime('now'))`).run(id);
    db.prepare(`INSERT INTO commissions (trader_id, amount, rate, type, status, created_at) VALUES (?, 90, 10, 'direct', 'pending', datetime('now'))`).run(id);
    const res = await request(app).get('/api/partner/earnings').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[6]).toMatchObject({ amount: 135 });
    expect(res.body).toMatchObject({ total: 135, paid: 45, pending: 90, bank: { last4: '4821' } });
  });

  test('payout masks the account and PAN', async () => {
    const { user: { id }, headers } = createTrader();
    db.prepare(`UPDATE users SET bank_account_number = '50100012344821', bank_ifsc = 'HDFC0001234', pan = 'ABCDE1234F', pan_verified = 1, razorpay_account_status = 'activated' WHERE id = ?`).run(id);
    const res = await request(app).get('/api/partner/payout').set(headers);
    expect(res.body).toMatchObject({ last4: '4821', pan_masked: 'ABCDE••••F', pan_verified: true, step: 4 });
    expect(JSON.stringify(res.body)).not.toMatch(/50100012344821/);
  });
});

describe('delivery hours', () => {
  test('defaults until saved, then saves 7 days', async () => {
    const { headers } = createTrader();
    const first = await request(app).get('/api/partner/hours').set(headers);
    expect(first.body.saved).toBe(false);
    expect(first.body.days[6].enabled).toBe(false);
    const days = first.body.days.map((d) => ({ ...d, start: 540, end: 1140 }));
    const put = await request(app).put('/api/partner/hours').set(headers).send({ days });
    expect(put.status).toBe(200);
    expect(put.body.saved).toBe(true);
    expect(put.body.days[0]).toMatchObject({ start: 540, end: 1140 });
  });

  test('rejects hours outside 6 AM–10 PM or shorter than an hour', async () => {
    const { headers } = createTrader();
    const base = (await request(app).get('/api/partner/hours').set(headers)).body.days;
    const early = base.map((d, i) => (i === 0 ? { ...d, start: 300 } : d));
    expect((await request(app).put('/api/partner/hours').set(headers).send({ days: early })).status).toBe(400);
    const short = base.map((d, i) => (i === 0 ? { ...d, start: 600, end: 630 } : d));
    expect((await request(app).put('/api/partner/hours').set(headers).send({ days: short })).status).toBe(400);
  });

  test('riders have no delivery hours', async () => {
    const rider = createRider();
    expect((await request(app).get('/api/partner/hours').set(rider.headers)).status).toBe(403);
  });
});

describe('rider jobs and profile', () => {
  test('a trader can opt in to rider jobs and back out', async () => {
    const { headers } = createTrader();
    expect((await request(app).put('/api/partner/rider-jobs').set(headers).send({ on: true })).body.takes_rider_jobs).toBe(true);
    expect((await request(app).get('/api/partner/home').set(headers)).body.takes_rider_jobs).toBe(true);
    await request(app).put('/api/partner/rider-jobs').set(headers).send({ on: false });
    expect((await request(app).get('/api/partner/home').set(headers)).body.takes_rider_jobs).toBe(false);
  });

  test('profile edits check the name and phone', async () => {
    const rider = createRider();
    const bad = await request(app).put('/api/partner/profile').set(rider.headers).send({ name: 'R', phone: '123' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(['name', 'phone']);
    const ok = await request(app).put('/api/partner/profile').set(rider.headers).send({ name: ' Ravi  K ', phone: '+91 98450 12345' });
    expect(ok.body).toEqual({ name: 'Ravi K', phone: '9845012345' });
  });
});
