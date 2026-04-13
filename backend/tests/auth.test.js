/**
 * Auth Route Tests — /api/auth
 *
 * Covers: trader login, trader registration, consumer register/verify/login,
 * password reset, referral validation, edge cases and security boundaries.
 */
const request = require('supertest');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const db      = require('../src/database/db');
const { createApp }  = require('./helpers/app');
const { clearAll, createTrader, createConsumer } = require('./helpers/factory');

const app = createApp();

beforeEach(() => clearAll());

// ─────────────────────────────────────────────────────────────────────────────
// Trader / Admin Login
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('returns JWT token on valid credentials', async () => {
    const { user } = createTrader({ email: 'trader@test.com', password: 'password123' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'trader@test.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.password).toBeUndefined(); // never leak password
  });

  test('returns 401 for wrong password', async () => {
    createTrader({ email: 'trader@test.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'trader@test.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('returns 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  test('returns 403 for suspended account', async () => {
    const { user } = createTrader({ email: 'suspended@test.com' });
    db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(user.id);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'suspended@test.com', password: 'TraderPass1!' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  test('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'trader@test.com' });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trader Registration
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/register (trader)', () => {
  test('registers Tier 1 trader and returns JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New Trader', email: 'newtrader@test.com', password: 'Secure123!' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.tier).toBe(1);
    expect(res.body.user.referral_code).toMatch(/^[A-Z]\d{4}$/);
  });

  test('registers Tier 2 trader using a valid Tier 1 referral code', async () => {
    const { user: t1 } = createTrader({ tier: 1, referral_code: 'A0000' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Sub Dealer',
        email: 'subdealer@test.com',
        password: 'Secure123!',
        referralCode: 'A0000',
      });

    expect(res.status).toBe(201);
    expect(res.body.user.tier).toBe(2);
    expect(res.body.user.referred_by_id).toBe(t1.id);
    expect(res.body.user.referral_code).toMatch(/^A\d{4}$/);
    expect(res.body.user.referral_code).not.toBe('A0000'); // must differ from parent
  });

  test('rejects registration with duplicate email', async () => {
    createTrader({ email: 'dup@test.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup', email: 'dup@test.com', password: 'Secure123!' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('rejects registration with invalid Tier 2 referral code', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'x@test.com', password: 'Secure123!', referralCode: 'ZZZZ9' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid referral code/i);
  });

  test('rejects password shorter than 6 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Short', email: 'short@test.com', password: '123' });

    expect(res.status).toBe(400);
  });

  test('rejects empty name', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '   ', email: 'noname@test.com', password: 'Secure123!' });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Current User (GET /me)
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  test('returns user profile for valid JWT', async () => {
    const { user, headers } = createTrader();
    const res = await request(app).get('/api/auth/me').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.password).toBeUndefined();
  });

  test('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 for malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  test('returns 401 for token signed with wrong secret', async () => {
    const jwt  = require('jsonwebtoken');
    const fake = jwt.sign({ id: 1, role: 'trader' }, 'wrong-secret');
    const res  = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${fake}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Referral Code Validation
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/auth/validate-referral/:code', () => {
  test('returns valid:true for an active Tier 1 code', async () => {
    createTrader({ tier: 1, referral_code: 'B0000' });
    const res = await request(app).get('/api/auth/validate-referral/B0000');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.referrerName).toBeDefined();
  });

  test('returns valid:false for unknown code', async () => {
    const res = await request(app).get('/api/auth/validate-referral/ZZZZZ');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Registration
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/consumer/register', () => {
  test('creates consumer account and returns dev_otp (no email configured)', async () => {
    const res = await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Alice', email: 'alice@test.com', password: 'Alice123!' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // dev_otp exposed when EMAIL_USER is not set (our test env)
    expect(res.body.dev_otp).toMatch(/^\d{6}$/);
  });

  test('links consumer to dealer using valid referral code', async () => {
    createTrader({ tier: 1, referral_code: 'C0000' });
    const res = await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Bob', email: 'bob@test.com', password: 'Bob123!', referral_code: 'C0000' });

    expect(res.status).toBe(201);
    const consumer = db.prepare('SELECT * FROM consumers WHERE email = ?').get('bob@test.com');
    expect(consumer.linked_dealer_id).not.toBeNull();
    expect(consumer.referral_code_used).toBe('C0000');
  });

  test('rejects duplicate email', async () => {
    await request(app).post('/api/auth/consumer/register')
      .send({ name: 'First', email: 'dup@test.com', password: 'Dup123!' });
    const res = await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Second', email: 'dup@test.com', password: 'Dup123!' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('rejects invalid referral code', async () => {
    const res = await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Charlie', email: 'charlie@test.com', password: 'Ch123!', referral_code: 'FAKE9' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer OTP Verification
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/consumer/verify-otp', () => {
  test('verifies correct OTP and returns JWT', async () => {
    const reg = await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Diana', email: 'diana@test.com', password: 'Diana123!' });
    const otp = reg.body.dev_otp;

    const res = await request(app)
      .post('/api/auth/consumer/verify-otp')
      .send({ email: 'diana@test.com', otp });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.consumer.email_verified).toBe(1);
  });

  test('rejects wrong OTP', async () => {
    await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Eve', email: 'eve@test.com', password: 'Eve123!' });

    const res = await request(app)
      .post('/api/auth/consumer/verify-otp')
      .send({ email: 'eve@test.com', otp: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  test('rejects already-used OTP', async () => {
    const reg = await request(app)
      .post('/api/auth/consumer/register')
      .send({ name: 'Frank', email: 'frank@test.com', password: 'Frank123!' });
    const otp = reg.body.dev_otp;

    // First use — should succeed
    await request(app).post('/api/auth/consumer/verify-otp').send({ email: 'frank@test.com', otp });
    // Second use — should fail
    const res = await request(app)
      .post('/api/auth/consumer/verify-otp')
      .send({ email: 'frank@test.com', otp });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Login
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/consumer/login', () => {
  test('returns JWT for verified consumer', async () => {
    const { consumer } = createConsumer({ email: 'login@test.com', password: 'Login123!' });
    const res = await request(app)
      .post('/api/auth/consumer/login')
      .send({ email: 'login@test.com', password: 'Login123!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.consumer.id).toBe(consumer.id);
    expect(res.body.consumer.password).toBeUndefined();
  });

  test('returns 403 for unverified consumer with code EMAIL_NOT_VERIFIED', async () => {
    // Insert unverified consumer directly
    const hash = bcrypt.hashSync('Test123!', 1);
    db.prepare(`
      INSERT INTO consumers (name, email, password, phone, status, email_verified)
      VALUES ('Unverified', 'unverified@test.com', ?, '9999999991', 'active', 0)
    `).run(hash);

    const res = await request(app)
      .post('/api/auth/consumer/login')
      .send({ email: 'unverified@test.com', password: 'Test123!' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('returns 401 for wrong password', async () => {
    createConsumer({ email: 'wrongpass@test.com' });
    const res = await request(app)
      .post('/api/auth/consumer/login')
      .send({ email: 'wrongpass@test.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
  });

  test('returns 401 with code EMAIL_NOT_FOUND for unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/consumer/login')
      .send({ email: 'ghost@test.com', password: 'Anything1!' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('EMAIL_NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password Reset Flow
// ─────────────────────────────────────────────────────────────────────────────
describe('Password reset flow', () => {
  test('forgot-password always returns success (does not reveal email existence)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('full password reset flow: request → reset → login with new password', async () => {
    createTrader({ email: 'resetme@test.com' });

    // 1. Request reset
    const reqRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'resetme@test.com' });
    expect(reqRes.status).toBe(200);
    const token = reqRes.body.dev_token;
    expect(token).toBeDefined();

    // 2. Reset password
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, new_password: 'NewSecure123!' });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // 3. Login with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'resetme@test.com', password: 'NewSecure123!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
  });

  test('reset-password rejects expired/invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'totally-fake-token', new_password: 'NewPass123!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  test('reset-password rejects reuse of already-used token', async () => {
    createTrader({ email: 'reuse@test.com' });

    const reqRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'reuse@test.com' });
    const token = reqRes.body.dev_token;

    // Use it once
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token, new_password: 'NewPass123!' });

    // Try to reuse
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, new_password: 'AnotherPass123!' });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dealer Referral Code Validation (for consumer registration)
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/auth/consumer/validate-dealer/:code', () => {
  test('returns valid:true for an active dealer referral code', async () => {
    createTrader({ tier: 1, referral_code: 'D0000' });
    const res = await request(app).get('/api/auth/consumer/validate-dealer/D0000');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.dealerName).toBeDefined();
  });

  test('returns valid:false for inactive dealer', async () => {
    const { user } = createTrader({ tier: 1, referral_code: 'E0000' });
    db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(user.id);

    const res = await request(app).get('/api/auth/consumer/validate-dealer/E0000');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });
});
