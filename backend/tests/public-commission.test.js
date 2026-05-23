/**
 * Part 5 — Public-token endpoints (commission confirmation flow)
 *
 * The sub-dealer confirmation flow runs without auth — its safety hinges on
 * the random token, the expiry window, and the awaiting_confirmation status
 * guard. These tests pin all three plus reason-length & XSS handling.
 */
const request = require('supertest');
const crypto  = require('crypto');
const { createApp } = require('./helpers/app');
const factory       = require('./helpers/factory');
const db            = require('../src/database/db');

const app = createApp();

beforeEach(() => factory.clearAll());

/* Insert a commission in `awaiting_confirmation` with given token + expiry */
function seedCommission({ expiresAt, status = 'awaiting_confirmation' } = {}) {
  const parent = factory.createTrader({ tier: 1 });
  const sub    = factory.createTrader({ tier: 2 });
  db.prepare('UPDATE users SET referred_by_id=? WHERE id=?').run(parent.user.id, sub.user.id);

  const consumer = factory.createConsumer({ linked_dealer_id: sub.user.id });
  const order    = factory.createConsumerOrder(consumer.consumer.id, {
    linked_dealer_id: sub.user.id, payment_status: 'paid',
  });

  const token = 'tok_' + crypto.randomBytes(8).toString('hex');
  const exp   = expiresAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const ins = db.prepare(`
    INSERT INTO commissions
      (trader_id, consumer_order_id, amount, rate, type, status,
       confirmation_token, confirmation_expires_at, payment_method,
       paid_by_trader_id, paid_at_offline,
       week_start, week_end)
    VALUES (?, ?, 10.00, 10, 'direct', ?, ?, ?, 'cash', ?, CURRENT_TIMESTAMP,
            '2026-05-18', '2026-05-24')
  `).run(sub.user.id, order.id, status, token, exp, parent.user.id);

  return { parent, sub, token, commissionId: ins.lastInsertRowid };
}

/* ── 5.1 GET (status surface) ────────────────────────────────────────── */
describe('GET /commission-confirmation/:token', () => {
  test('Valid token → 200 with commission body + expired=false', async () => {
    const { token } = seedCommission();
    const res = await request(app).get(`/api/public/commission-confirmation/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.commission.status).toBe('awaiting_confirmation');
    expect(res.body.sub_dealer).toBeDefined();
    expect(res.body.parent).toBeDefined();
    expect(res.body.expired).toBe(false);
  });

  test('Expired (>14 days) token → 200 with expired=true', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { token } = seedCommission({ expiresAt: past });
    const res = await request(app).get(`/api/public/commission-confirmation/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.expired).toBe(true);
  });

  test('Random / tampered token → 404', async () => {
    const res = await request(app).get('/api/public/commission-confirmation/totally-fake-token');
    expect(res.status).toBe(404);
  });

  test('Token leaked from another commission cannot read this one', async () => {
    const a = seedCommission();
    const b = seedCommission();
    expect(a.token).not.toBe(b.token);
    const res = await request(app).get(`/api/public/commission-confirmation/${a.token}`);
    expect(res.body.commission.id).toBe(a.commissionId);
    expect(res.body.commission.id).not.toBe(b.commissionId);
  });
});

/* ── 5.2 Confirm ─────────────────────────────────────────────────────── */
describe('POST /commission-confirmation/:token/confirm', () => {
  test('Happy path → 200, commission becomes paid, token cleared', async () => {
    const { token, commissionId } = seedCommission();
    const res = await request(app).post(`/api/public/commission-confirmation/${token}/confirm`);
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT status, confirmation_token, confirmed_at FROM commissions WHERE id=?').get(commissionId);
    expect(row.status).toBe('paid');
    expect(row.confirmation_token).toBeNull();
    expect(row.confirmed_at).toBeTruthy();
  });

  test('Replay (same token twice) → second call 404 (token nulled)', async () => {
    const { token } = seedCommission();
    await request(app).post(`/api/public/commission-confirmation/${token}/confirm`).expect(200);
    const r2 = await request(app).post(`/api/public/commission-confirmation/${token}/confirm`);
    expect([400, 404]).toContain(r2.status);
  });

  test('Expired token → 400', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { token } = seedCommission({ expiresAt: past });
    const res = await request(app).post(`/api/public/commission-confirmation/${token}/confirm`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('Random token → 404', async () => {
    const res = await request(app).post('/api/public/commission-confirmation/nope-not-real/confirm');
    expect(res.status).toBe(404);
  });
});

/* ── 5.3 Dispute ─────────────────────────────────────────────────────── */
describe('POST /commission-confirmation/:token/dispute', () => {
  test('Happy path → 200, commission becomes disputed with reason saved', async () => {
    const { token, commissionId } = seedCommission();
    const res = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: 'never received the cash' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT status, dispute_reason, confirmation_token FROM commissions WHERE id=?').get(commissionId);
    expect(row.status).toBe('disputed');
    expect(row.dispute_reason).toBe('never received the cash');
    expect(row.confirmation_token).toBeNull();
  });

  test('Dispute reason > 1000 chars is truncated to 1000', async () => {
    const { token, commissionId } = seedCommission();
    const huge = 'X'.repeat(5000);
    const res = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: huge });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT dispute_reason FROM commissions WHERE id=?').get(commissionId);
    expect(row.dispute_reason.length).toBe(1000);
    expect(row.dispute_reason).toBe('X'.repeat(1000));
  });

  test('Missing reason still allowed (stored as null)', async () => {
    const { token, commissionId } = seedCommission();
    const res = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({});
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT dispute_reason FROM commissions WHERE id=?').get(commissionId);
    expect(row.dispute_reason).toBeNull();
  });

  test('XSS in reason is stored raw (frontend / email layer is the escape boundary)', async () => {
    const { token, commissionId } = seedCommission();
    const payload = `<script>alert('xss')</script><img src=x onerror=1>`;
    const res = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: payload });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT dispute_reason FROM commissions WHERE id=?').get(commissionId);
    // Raw storage is intentional; escape happens at render time.
    // Crucially: the input string is NOT executed or re-interpreted by SQL.
    expect(row.dispute_reason).toBe(payload);
  });

  test('Email service is called with the raw reason (escape happens in template)', async () => {
    const emailService = require('../src/services/emailService');
    const spy = emailService.sendCommissionDisputeEmail;
    spy.mockClear?.();

    const { token } = seedCommission();
    const reason = '<script>alert(1)</script>';
    await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason })
      .expect(200);

    // Sent at least once (parent + admins, if any)
    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls;
    const last  = calls[calls.length - 1][1];
    expect(last.reason).toBe(reason);
  });

  test('Expired token on dispute → 400', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { token } = seedCommission({ expiresAt: past });
    const res = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: 'late but real' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('Random token → 404', async () => {
    const res = await request(app)
      .post('/api/public/commission-confirmation/zzz-bad-token/dispute')
      .send({ reason: 'x' });
    expect(res.status).toBe(404);
  });
});

/* ── 5.4 Cross-action transitions (confirm ↔ dispute) ────────────────── */
describe('Cross-action transitions', () => {
  test('Confirm → Dispute → second call rejected', async () => {
    const { token } = seedCommission();
    await request(app).post(`/api/public/commission-confirmation/${token}/confirm`).expect(200);
    const r = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: 'changed mind' });
    expect([400, 404]).toContain(r.status);
  });

  test('Dispute → Confirm → second call rejected', async () => {
    const { token } = seedCommission();
    await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: 'no' })
      .expect(200);
    const r = await request(app).post(`/api/public/commission-confirmation/${token}/confirm`);
    expect([400, 404]).toContain(r.status);
  });

  test('Pending (not awaiting_confirmation) commission → confirm/dispute → 400', async () => {
    const { token } = seedCommission({ status: 'pending' });
    const c = await request(app).post(`/api/public/commission-confirmation/${token}/confirm`);
    expect(c.status).toBe(400);
    expect(c.body.error).toMatch(/cannot confirm|pending/i);
    const d = await request(app)
      .post(`/api/public/commission-confirmation/${token}/dispute`)
      .send({ reason: 'x' });
    expect(d.status).toBe(400);
  });
});

/* ── 5.5 Route shape ─────────────────────────────────────────────────── */
describe('Route shape', () => {
  test('Missing token in path → 404 (route does not match)', async () => {
    const res = await request(app).get('/api/public/commission-confirmation/');
    expect(res.status).toBe(404);
  });

  test('URL-encoded token round-trips correctly', async () => {
    const parent = factory.createTrader({ tier: 1 });
    const sub    = factory.createTrader({ tier: 2 });
    db.prepare('UPDATE users SET referred_by_id=? WHERE id=?').run(parent.user.id, sub.user.id);
    const consumer = factory.createConsumer({ linked_dealer_id: sub.user.id });
    const order = factory.createConsumerOrder(consumer.consumer.id, {
      linked_dealer_id: sub.user.id, payment_status: 'paid',
    });
    const raw = 'token with spaces & %';
    const exp = new Date(Date.now() + 1e6).toISOString();
    db.prepare(`
      INSERT INTO commissions
        (trader_id, consumer_order_id, amount, rate, type, status,
         confirmation_token, confirmation_expires_at,
         week_start, week_end)
      VALUES (?, ?, 10, 10, 'direct', 'awaiting_confirmation', ?, ?, '2026-05-18', '2026-05-24')
    `).run(sub.user.id, order.id, raw, exp);

    const res = await request(app)
      .get(`/api/public/commission-confirmation/${encodeURIComponent(raw)}`);
    expect(res.status).toBe(200);
    expect(res.body.commission.status).toBe('awaiting_confirmation');
  });
});
