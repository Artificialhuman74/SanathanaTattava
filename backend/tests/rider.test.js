/**
 * Rider signup + review tests — /api/rider and /api/admin/riders
 *
 * Covers: email signup with KYC photos, validation messages per field,
 * walking riders skipping the licence, duplicate emails, pending riders
 * logging in, admin approve / send back, resubmission, and KYC privacy.
 */
const request = require('supertest');
const sharp   = require('sharp');
const db      = require('../src/database/db');
const { createApp } = require('./helpers/app');
const { clearAll, createAdmin, createTrader, tokenFor, authHeader } = require('./helpers/factory');

const mockSend = jest.fn(async ({ tokens }) => ({
  successCount: tokens.length - 1,
  failureCount: 1,
  // The last token is reported dead so cleanup can be checked.
  responses: tokens.map((_, i) => (i === tokens.length - 1
    ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
    : { success: true })),
}));
jest.mock('../src/services/firebaseAdmin', () => ({
  verifyIdToken: jest.fn(async (token) => {
    if (token === 'good-google-token') return { uid: 'google-uid-1', email: 'Asha.Google@Example.com', name: 'Asha' };
    throw new Error('bad token');
  }),
  messaging: () => ({ sendEachForMulticast: mockSend }),
}));

const app = createApp();
let photo;

beforeAll(async () => {
  photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 180, b: 120 } } })
    .jpeg().toBuffer();
});
beforeEach(() => clearAll());

const scooterFields = (overrides = {}) => ({
  name: 'Ravi  Kumar',
  phone: '+91 98765 43210',
  email: 'Ravi@Example.com',
  password: 'oilpress24',
  base_label: 'home',
  base_address: '12, 3rd Cross, Jayanagar 4th Block, Bengaluru 560011',
  base_lat: '12.9255',
  base_lng: '77.5936',
  vehicle_type: 'scooter',
  vehicle_plate: 'ka 05 mx 2481',
  licence_number: 'KA05 2019 0012345',
  pan: 'abcde1234f',
  bank_account_name: 'Ravi Kumar',
  bank_account_number: '5010 0238 1482 1',
  bank_ifsc: 'hdfc0001234',
  emergency_name: 'Savitha Kumar',
  emergency_relation: 'Mother',
  emergency_phone: '98765 43211',
  ...overrides,
});

function signup(fields, photos = ['selfie', 'licence_front', 'licence_back', 'pan_photo'], path = '/api/rider/register') {
  const req = request(app).post(path);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  for (const name of photos) req.attach(name, photo, { filename: `${name}.jpg`, contentType: 'image/jpeg' });
  return req;
}

describe('POST /api/rider/register', () => {
  test('creates a pending rider who can log in right away', async () => {
    const res = await signup(scooterFields());
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    const u = res.body.user;
    expect(u.role).toBe('rider');
    expect(u.review_status).toBe('pending_review');
    expect(u.password).toBeUndefined();
    expect(u.email).toBe('ravi@example.com');
    expect(u.phone).toBe('9876543210');
    expect(u.name).toBe('Ravi Kumar');
    expect(u.vehicle_plate).toBe('KA 05 MX 2481');
    expect(u.pan).toBe('ABCDE1234F');
    expect(u.bank_account_number).toBe('5010023814821');
    expect(u.bank_ifsc).toBe('HDFC0001234');
    expect(u.emergency_relation).toBe('mother');
    expect(u.kyc_selfie).toMatch(/\.webp$/);
    expect(u.h3_index).toBeTruthy();

    const base = db.prepare('SELECT * FROM user_addresses WHERE user_id = ?').all(u.id);
    expect(base).toHaveLength(1);
    expect(base[0].is_default).toBe(1);

    const login = await request(app).post('/api/auth/login').send({ email: 'ravi@example.com', password: 'oilpress24' });
    expect(login.status).toBe(200);
    expect(login.body.user.review_status).toBe('pending_review');
  });

  test('walking riders skip plate, licence number and licence photos', async () => {
    const res = await signup(
      scooterFields({ vehicle_type: 'walk', vehicle_plate: '', licence_number: '' }),
      ['selfie', 'pan_photo'],
    );
    expect(res.status).toBe(201);
    expect(res.body.user.vehicle_plate).toBeNull();
    expect(res.body.user.kyc_licence_front).toBeNull();
  });

  test('scooter riders must send both licence photos', async () => {
    const res = await signup(scooterFields(), ['selfie', 'pan_photo', 'licence_front']);
    expect(res.status).toBe(400);
    expect(res.body.fields.licence_back).toMatch(/back of your licence/i);
  });

  test('explains each bad field in plain words', async () => {
    const res = await signup(scooterFields({
      phone: '12345', pan: 'ABC', bank_ifsc: 'HDFC1234', password: 'short', base_lat: 'x',
    }));
    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({
      phone: expect.stringMatching(/10-digit/),
      pan: expect.stringMatching(/ABCDE1234F/),
      bank_ifsc: expect.stringMatching(/HDFC0001234/),
      password: expect.stringMatching(/8/),
      base_lat: expect.stringMatching(/pin/i),
    });
  });

  test('the emergency contact cannot be the rider’s own number', async () => {
    const res = await signup(scooterFields({ emergency_phone: '9876543210' }));
    expect(res.status).toBe(400);
    expect(res.body.fields.emergency_phone).toMatch(/someone else/i);
  });

  test('refuses an email that already has an account', async () => {
    createTrader({ email: 'ravi@example.com' });
    const res = await signup(scooterFields());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  test('rejects non-image uploads', async () => {
    const res = await request(app).post('/api/rider/register')
      .field('name', 'Ravi')
      .attach('selfie', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/rider/register/google', () => {
  test('takes the email from the verified Google token', async () => {
    const fields = scooterFields({ id_token: 'good-google-token' });
    delete fields.email; delete fields.password;
    const res = await signup(fields, undefined, '/api/rider/register/google');
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('asha.google@example.com');
    expect(res.body.user.google_uid).toBe('google-uid-1');
  });

  test('refuses a bad token', async () => {
    const res = await signup(scooterFields({ id_token: 'nope' }), undefined, '/api/rider/register/google');
    expect(res.status).toBe(401);
  });
});

describe('admin review and resubmission', () => {
  async function newRider() {
    const res = await signup(scooterFields());
    return { id: res.body.user.id, token: res.body.token };
  }

  test('admin lists, opens, and approves a rider', async () => {
    const rider = await newRider();
    const { token: adminToken } = createAdmin();

    const list = await request(app).get('/api/admin/riders').set(authHeader(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.counts.pending_review).toBe(1);
    expect(list.body.riders[0]).toMatchObject({ id: rider.id, base_label: 'home', resubmitted: false });

    const detail = await request(app).get(`/api/admin/riders/${rider.id}`).set(authHeader(adminToken));
    expect(detail.body.rider.photos).toEqual({ selfie: true, licence_front: true, licence_back: true, pan_photo: true });

    const img = await request(app).get(`/api/admin/riders/${rider.id}/kyc/selfie`).set(authHeader(adminToken));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/webp/);
    expect(img.headers['cache-control']).toMatch(/no-store/);
    const thumb = await request(app).get(`/api/admin/riders/${rider.id}/kyc/selfie?size=thumb`).set(authHeader(adminToken));
    expect(thumb.status).toBe(200);
    const fullMeta = await sharp(img.body).metadata();
    const thumbMeta = await sharp(thumb.body).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBeLessThanOrEqual(480);
    expect(thumbMeta.width).toBeLessThanOrEqual(fullMeta.width);

    const ok = await request(app).post(`/api/admin/riders/${rider.id}/review`)
      .set(authHeader(adminToken)).send({ decision: 'approve' });
    expect(ok.status).toBe(200);
    const app2 = await request(app).get('/api/rider/application').set(authHeader(rider.token));
    expect(app2.body.review_status).toBe('approved');
  });

  test('send back → rider fixes only what was flagged → pending again', async () => {
    const rider = await newRider();
    const { token: adminToken } = createAdmin();
    const back = await request(app).post(`/api/admin/riders/${rider.id}/review`).set(authHeader(adminToken)).send({
      decision: 'reject',
      issues: [
        { item: 'licence_back', reason: 'Too blurry to read. Take it again in good light.' },
        { item: 'bank', reason: 'The name does not match your bank.' },
      ],
    });
    expect(back.status).toBe(200);

    const mine = await request(app).get('/api/rider/application').set(authHeader(rider.token));
    expect(mine.body.review_status).toBe('rejected');
    expect(mine.body.review_issues.map((i) => i.item)).toEqual(['licence_back', 'bank']);
    expect(mine.body.application.bank_account_last4).toBe('4821');
    const oldBack = db.prepare('SELECT kyc_licence_back FROM users WHERE id = ?').get(rider.id).kyc_licence_back;

    const fix = await request(app).put('/api/rider/application').set(authHeader(rider.token))
      .field('bank_account_name', 'RAVI KUMAR S')
      .attach('licence_back', photo, { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(fix.status).toBe(200);
    expect(fix.body.review_status).toBe('pending_review');
    expect(fix.body.review_issues).toEqual([]);
    expect(fix.body.application.bank_account_name).toBe('RAVI KUMAR S');
    const newBack = db.prepare('SELECT kyc_licence_back FROM users WHERE id = ?').get(rider.id).kyc_licence_back;
    expect(newBack).not.toBe(oldBack);

    const list = await request(app).get('/api/admin/riders').set(authHeader(adminToken));
    expect(list.body.riders[0].resubmitted).toBe(true);
  });

  test('a rider can’t resend while still waiting', async () => {
    const rider = await newRider();
    const res = await request(app).put('/api/rider/application').set(authHeader(rider.token)).field('name', 'Ravi K');
    expect(res.status).toBe(409);
  });

  test('send back needs a reason for every flagged item', async () => {
    const rider = await newRider();
    const { token: adminToken } = createAdmin();
    const res = await request(app).post(`/api/admin/riders/${rider.id}/review`).set(authHeader(adminToken))
      .send({ decision: 'reject', issues: [{ item: 'selfie', reason: '' }] });
    expect(res.status).toBe(400);
  });

  test('KYC photos are admin-only', async () => {
    const rider = await newRider();
    const { token: traderToken } = createTrader();
    for (const token of [rider.token, traderToken]) {
      const res = await request(app).get(`/api/admin/riders/${rider.id}/kyc/selfie`).set(authHeader(token));
      expect(res.status).toBe(403);
    }
    const anon = await request(app).get(`/api/admin/riders/${rider.id}/kyc/selfie`);
    expect(anon.status).toBe(401);
  });

  test('riders can’t use trader routes', async () => {
    const rider = await newRider();
    const res = await request(app).get('/api/trader/dashboard').set(authHeader(tokenFor(rider.id, 'rider')));
    expect([403, 404]).toContain(res.status);
  });
});

describe('push notifications for review decisions', () => {
  const TOKEN_A = 'fcm-token-phone-a-0123456789';
  const TOKEN_B = 'fcm-token-phone-b-0123456789';

  beforeEach(() => mockSend.mockClear());

  test('a phone registers once and moves with the account that last used it', async () => {
    const res = await signup(scooterFields());
    const rider = res.body;
    const reg = await request(app).post('/api/devices').set(authHeader(rider.token)).send({ token: TOKEN_A, app_version: '0.1.0' });
    expect(reg.status).toBe(200);
    await request(app).post('/api/devices').set(authHeader(rider.token)).send({ token: TOKEN_A });
    expect(db.prepare('SELECT COUNT(*) AS n FROM device_tokens').get().n).toBe(1);

    const { user: trader, token: traderToken } = createTrader();
    await request(app).post('/api/devices').set(authHeader(traderToken)).send({ token: TOKEN_A });
    expect(db.prepare('SELECT user_id FROM device_tokens WHERE token = ?').get(TOKEN_A).user_id).toBe(trader.id);

    const bad = await request(app).post('/api/devices').set(authHeader(traderToken)).send({ token: 'x' });
    expect(bad.status).toBe(400);
  });

  test('approval pushes "You’re approved!" and drops tokens FCM says are dead', async () => {
    const res = await signup(scooterFields());
    const { token: riderToken, user } = res.body;
    await request(app).post('/api/devices').set(authHeader(riderToken)).send({ token: TOKEN_A });
    await request(app).post('/api/devices').set(authHeader(riderToken)).send({ token: TOKEN_B });
    const { token: adminToken } = createAdmin();

    const ok = await request(app).post(`/api/admin/riders/${user.id}/review`).set(authHeader(adminToken)).send({ decision: 'approve' });
    expect(ok.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(mockSend).toHaveBeenCalledTimes(1);
    const msg = mockSend.mock.calls[0][0];
    expect(msg.tokens.sort()).toEqual([TOKEN_A, TOKEN_B].sort());
    expect(msg.notification.title).toMatch(/approved/i);
    expect(msg.data).toEqual({ type: 'rider_review', review_status: 'approved' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ?').get(user.id).n).toBe(1);
  });

  test('send back pushes how many things need fixing', async () => {
    const res = await signup(scooterFields());
    const { token: riderToken, user } = res.body;
    await request(app).post('/api/devices').set(authHeader(riderToken)).send({ token: TOKEN_A });
    const { token: adminToken } = createAdmin();
    await request(app).post(`/api/admin/riders/${user.id}/review`).set(authHeader(adminToken)).send({
      decision: 'reject',
      issues: [{ item: 'selfie', reason: 'Helmet on' }, { item: 'pan', reason: 'Cut off' }],
    });
    await new Promise((r) => setImmediate(r));
    expect(mockSend.mock.calls[0][0].notification.title).toBe('2 things need fixing');
  });

  test('logging out stops pushes to that phone', async () => {
    const res = await signup(scooterFields());
    await request(app).post('/api/devices').set(authHeader(res.body.token)).send({ token: TOKEN_A });
    await request(app).delete('/api/devices').set(authHeader(res.body.token)).send({ token: TOKEN_A });
    expect(db.prepare('SELECT COUNT(*) AS n FROM device_tokens').get().n).toBe(0);
  });
});
