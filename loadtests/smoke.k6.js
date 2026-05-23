/**
 * smoke.k6.js — CI smoke run (Part 10 / 11).
 *
 * Runs on every PR via the `load-smoke` CI job.  Tiny VU count, short
 * duration — goal is "server boots, responds, doesn't 5xx under trivial load".
 *
 * Full load scenarios live in the other k6 files and run nightly.
 *
 * Environment:
 *   BASE_URL   — default http://localhost:5001
 *   K6_SMOKE   — set to '1' by CI to use minimal thresholds
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5001';

const errorRate = new Rate('errors');

export const options = {
  vus: 5,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],       // < 1 % errors
    http_req_duration: ['p(95)<2000'],    // p95 < 2 s
    errors: ['rate<0.01'],
  },
};

export default function () {
  // 1. Health check
  const health = http.get(`${BASE_URL}/api/health`);
  const ok1 = check(health, {
    'health 200': (r) => r.status === 200,
    'health body ok': (r) => {
      try { return JSON.parse(r.body).status === 'ok'; } catch { return false; }
    },
  });
  errorRate.add(!ok1);

  // 2. Consumer products list (no auth, most heavily cached path)
  const products = http.get(`${BASE_URL}/api/consumer/products`);
  const ok2 = check(products, {
    'products 200': (r) => r.status === 200,
  });
  errorRate.add(!ok2);

  // 3. Consumer settings (no auth)
  const settings = http.get(`${BASE_URL}/api/consumer/settings`);
  const ok3 = check(settings, {
    'settings 200': (r) => r.status === 200,
  });
  errorRate.add(!ok3);

  // 4. Protected endpoint without token → must be 401/403, never 5xx
  const adminNoAuth = http.get(`${BASE_URL}/api/admin/users`);
  const ok4 = check(adminNoAuth, {
    'admin-noauth not 5xx': (r) => r.status < 500,
    'admin-noauth rejects': (r) => r.status === 401 || r.status === 403,
  });
  errorRate.add(!ok4);

  sleep(0.5);
}
