/**
 * baseline.k6.js — average daily load simulation (Part 11).
 *
 * Scenario: 50 RPS for 5 minutes across the three highest-traffic read paths.
 * Records p50/p95/p99 — run nightly, compare with previous baseline.
 *
 * Usage:
 *   k6 run loadtests/baseline.k6.js --env BASE_URL=http://localhost:5001
 *
 * The script needs a seeded DB (npm run seed) and a running backend.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5001';

export const options = {
  scenarios: {
    baseline_load: {
      executor: 'constant-arrival-rate',
      rate: 50,          // 50 requests/second
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 60,
      maxVUs: 100,
    },
  },
  thresholds: {
    // SLA: no 5xx, p99 < 2 s
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(99)<2000', 'p(95)<1000', 'p(50)<400'],
  },
};

const errorRate  = new Rate('errors');
const shopTrend  = new Trend('shop_duration',    true);
const verifyTrend = new Trend('verify_duration', true);
const ordersTrend = new Trend('orders_duration', true);

// Round-robin across 3 endpoints matching the plan targets:
//   /api/consumer/products   (shop browse — no auth)
//   /api/consumer/orders     (consumer order list — needs token; sampled with fake)
//   /api/payments/verify     (skipped in baseline — POST w/ real payload only in soak)
const endpoints = [
  () => {
    const r = http.get(`${BASE_URL}/api/consumer/products`);
    shopTrend.add(r.timings.duration);
    return check(r, { 'shop 200': (res) => res.status === 200 });
  },
  () => {
    // Auth wall returns 401 — we're testing that the server doesn't 5xx,
    // and measuring the latency of the auth middleware path.
    const r = http.get(`${BASE_URL}/api/consumer/orders`, {
      headers: { Authorization: 'Bearer invalid-token-baseline' },
    });
    ordersTrend.add(r.timings.duration);
    return check(r, { 'orders auth-wall <500': (res) => res.status < 500 });
  },
];

export default function () {
  const fn = endpoints[Math.floor(Math.random() * endpoints.length)];
  const ok = fn();
  errorRate.add(!ok);
  sleep(0.1);
}
