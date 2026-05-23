/**
 * Part 19 — Observability & ops
 */
const request = require('supertest');
const { createApp } = require('./helpers/app');
const factory = require('./helpers/factory');

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  factory.clearAll();
});

describe('GET /api/health', () => {
  test('returns status ok and db ok with 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });

  test('includes a timestamp that is a valid ISO-8601 string', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    const parsed = new Date(res.body.timestamp);
    expect(parsed.toISOString()).toBe(res.body.timestamp);
  });

  test('response includes X-Request-ID header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  test('does NOT include razorpay key in response', async () => {
    const res = await request(app).get('/api/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/razorpay/i);
  });
});

describe('X-Request-ID middleware', () => {
  test('echoes back the X-Request-ID header if provided', async () => {
    const myId = 'test-request-id-12345';
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-ID', myId);

    expect(res.headers['x-request-id']).toBe(myId);
  });

  test('generates a new UUID if X-Request-ID header is absent', async () => {
    const res = await request(app).get('/api/health');
    const id = res.headers['x-request-id'];
    expect(id).toBeDefined();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('authenticated endpoints also include X-Request-ID header', async () => {
    const { headers } = factory.createAdmin();
    const res = await request(app)
      .get('/api/admin/stats')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  test('two requests without X-Request-ID get different IDs', async () => {
    const res1 = await request(app).get('/api/health');
    const res2 = await request(app).get('/api/health');
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
  });
});
