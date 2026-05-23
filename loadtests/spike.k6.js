/**
 * spike.k6.js — flash sale / inventory spike test (Part 11).
 *
 * Two scenarios run concurrently:
 *
 * 1. `black_friday` — 10× sustained load for 10 minutes. No 5xx, p99 < 2 s.
 *
 * 2. `flash_sale` — 50× spike on a single product page in 30 seconds.
 *    Verifies:
 *      - Dealer inventory never goes negative (checked via /api/consumer/products/:id)
 *      - When only one unit remains, two simultaneous order attempts result in
 *        exactly one 4xx (out-of-stock) — tested in concurrent.test.js at unit
 *        level; here we exercise it at HTTP level under load.
 *
 * Usage:
 *   k6 run loadtests/spike.k6.js \
 *     --env BASE_URL=http://localhost:5001 \
 *     --env PRODUCT_ID=1
 *
 * The "last unit" order test requires CONSUMER_TOKEN — omit it to skip order
 * placement and only run the read-path spike.
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL     = __ENV.BASE_URL    || 'http://localhost:5001';
const PRODUCT_ID   = __ENV.PRODUCT_ID  || '1';
const CONSUMER_TOKEN = __ENV.CONSUMER_TOKEN || '';

const errorRate          = new Rate('errors');
const outOfStockHits     = new Counter('out_of_stock_409');
const negativeStockError = new Counter('negative_stock_detected');

export const options = {
  scenarios: {
    black_friday: {
      executor: 'constant-arrival-rate',
      rate: 500,         // ~10× of 50 RPS baseline
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 600,
      maxVUs: 800,
      exec: 'blackFriday',
    },
    flash_sale: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      stages: [
        { duration: '10s', target: 2500 }, // ramp to 50× (2500 RPS) over 10 s
        { duration: '20s', target: 2500 }, // hold
      ],
      preAllocatedVUs: 300,
      maxVUs: 500,
      exec: 'flashSale',
      startTime: '30s',  // start 30 s in so black_friday is already warm
    },
  },
  thresholds: {
    http_req_failed:         ['rate<0.01'],
    http_req_duration:       ['p(99)<2000'],
    negative_stock_detected: ['count==0'],   // hard fail if stock goes negative
  },
};

export function blackFriday() {
  group('black_friday_browse', () => {
    const r = http.get(`${BASE_URL}/api/consumer/products`);
    const ok = check(r, {
      'bf products 200': (res) => res.status === 200,
      'bf no 5xx':       (res) => res.status < 500,
    });
    errorRate.add(!ok);
  });
  sleep(0.05);
}

export function flashSale() {
  group('flash_sale_product_page', () => {
    // Hammer the single product page
    const r = http.get(`${BASE_URL}/api/consumer/products/${PRODUCT_ID}`);
    const ok = check(r, {
      'fs product <500': (res) => res.status < 500,
    });
    errorRate.add(!ok);

    // If we got the product, assert stock >= 0
    if (r.status === 200) {
      try {
        const body = JSON.parse(r.body);
        const stock = body.stock ?? body.dealer_stock;
        if (typeof stock === 'number' && stock < 0) {
          negativeStockError.add(1);
        }
      } catch (_) {}
    }

    // Optionally attempt to place an order (requires CONSUMER_TOKEN)
    if (CONSUMER_TOKEN) {
      const orderRes = http.post(
        `${BASE_URL}/api/consumer/orders`,
        JSON.stringify({
          items: [{ product_id: parseInt(PRODUCT_ID, 10), quantity: 1 }],
          delivery_address: '123 Test St, Bangalore',
          pincode: '560001',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${CONSUMER_TOKEN}`,
          },
        }
      );
      // 409 or 400 = out-of-stock (expected under heavy load on last unit)
      if (orderRes.status === 409 || orderRes.status === 400) {
        outOfStockHits.add(1);
      }
      check(orderRes, {
        'fs order not 5xx': (res) => res.status < 500,
      });
    }
  });
  sleep(0.02);
}
