/**
 * GET /api/route: proxies OSRM for the live maps, caches, and survives OSRM being down.
 */
const request = require('supertest');
const { createApp } = require('./helpers/app');
const routing = require('../src/routes/routing');

const app = createApp();
const realFetch = global.fetch;

const osrmReply = {
  routes: [{ distance: 1840.5, duration: 312.2, geometry: { coordinates: [[77.58, 12.93], [77.59, 12.94], [77.6, 12.95]] } }],
};

beforeEach(() => {
  routing._reset();
  delete process.env.OSRM_URL;
});
afterAll(() => { global.fetch = realFetch; });

test('returns the road route as lat/lng points from our OSRM server', async () => {
  process.env.OSRM_URL = 'http://osrm.railway.internal:5000/';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => osrmReply });
  const res = await request(app).get('/api/route').query({ from: '12.93,77.58', to: '12.95,77.60' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ points: [[12.93, 77.58], [12.94, 77.59], [12.95, 77.6]], metres: 1840.5, seconds: 312.2 });
  expect(global.fetch.mock.calls[0][0]).toBe('http://osrm.railway.internal:5000/route/v1/driving/77.5800,12.9300;77.6000,12.9500?overview=full&geometries=geojson');
});

test('falls back to the public demo server and caches nearby repeats', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => osrmReply });
  await request(app).get('/api/route').query({ from: '12.93,77.58', to: '12.95,77.60' }).expect(200);
  await request(app).get('/api/route').query({ from: '12.93001,77.58001', to: '12.95,77.60' }).expect(200);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\//);
});

test('bad input is a 400; OSRM down is a 503, not a crash', async () => {
  await request(app).get('/api/route').query({ from: 'nope', to: '12.95,77.60' }).expect(400);
  global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  const res = await request(app).get('/api/route').query({ from: '12.93,77.58', to: '12.95,77.60' });
  expect(res.status).toBe(503);
});
