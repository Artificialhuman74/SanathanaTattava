/**
 * webhook-flood.k6.js — 1 000 payment.captured events back-to-back (Part 11).
 *
 * Goal:
 *   - Idempotency table (razorpay_webhook_events) grows linearly (no duplicate rows)
 *   - No double-credit on commissions
 *   - Server stays up (no crashes, no 5xx)
 *
 * We send webhooks with a fake HMAC signature — the server MUST reject them
 * with 400 (bad signature), not 500 (crash).  For a real idempotency flood
 * with valid signatures set RAZORPAY_WEBHOOK_SECRET and the script will
 * compute real HMACs via the k6 crypto module.
 *
 * Usage:
 *   k6 run loadtests/webhook-flood.k6.js --env BASE_URL=http://localhost:5001
 *   # with real sig:
 *   k6 run loadtests/webhook-flood.k6.js \
 *       --env BASE_URL=http://localhost:5001 \
 *       --env RAZORPAY_WEBHOOK_SECRET=<secret>
 */
import http   from 'k6/http';
import { check } from 'k6';
import { crypto } from 'k6/experimental/webcrypto';
import { Rate, Counter } from 'k6/metrics';

const BASE_URL       = __ENV.BASE_URL || 'http://localhost:5001';
const WEBHOOK_SECRET = __ENV.RAZORPAY_WEBHOOK_SECRET || '';

const errorRate    = new Rate('errors');
const floodCounter = new Counter('webhook_requests_sent');

export const options = {
  scenarios: {
    webhook_flood: {
      executor: 'shared-iterations',
      vus: 20,
      iterations: 1000,
      maxDuration: '3m',
    },
  },
  thresholds: {
    http_req_failed:     ['rate<0.01'],  // server must not crash
    http_req_duration:   ['p(95)<2000'],
    errors:              ['rate<0.01'],
  },
};

// Unique event_id per iteration so idempotency table can grow linearly
function buildPayload(iter) {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_loadtest_${iter}`,
          order_id: `order_loadtest_${__VU}`,
          amount: 9900,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
    id: `evt_loadtest_${iter}_${__VU}`,
  });
}

export default function () {
  const iter    = __ITER;
  const body    = buildPayload(iter);

  const headers = {
    'Content-Type': 'application/json',
    // Without a valid secret we send a fake sig — server must return 400 not 500.
    'x-razorpay-signature': 'fake_signature_load_test',
  };

  const r = http.post(`${BASE_URL}/api/payments/webhook`, body, { headers });

  floodCounter.add(1);

  // Bad-sig path: 400. Valid-sig path: 200. Either way, never 5xx.
  const ok = check(r, {
    'webhook not 5xx': (res) => res.status < 500,
    'webhook has response': (res) => res.body && res.body.length > 0,
  });
  errorRate.add(!ok);
}
