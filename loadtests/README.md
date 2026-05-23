# Load Tests (k6)

Part 11 of the TESTING_PLAN: performance, load & spike tests using [k6](https://k6.io).

## Scripts

| File | Scenario | When to run |
|------|----------|-------------|
| `smoke.k6.js` | 5 VUs × 20 s, 4 endpoints | Every PR via CI `load-smoke` job |
| `baseline.k6.js` | 50 RPS × 5 min, read paths | Nightly |
| `spike.k6.js` | 10× BF sustained + 50× flash sale | Nightly / before releases |
| `checkout-soak.k6.js` | 100 concurrent verify calls × 2 min | Nightly |
| `webhook-flood.k6.js` | 1 000 webhook events, 20 VUs | Nightly |
| `socket-storm.k6.js` | 500 WS clients in 5 s | Nightly |

## Prerequisites

```bash
# macOS
brew install k6

# Ubuntu / CI
sudo apt-get install k6   # see ci.yml for the apt key setup
```

## Quick start

```bash
# Run the smoke suite against a local backend (must be running + seeded)
cd backend && npm run seed && npm run dev &
k6 run loadtests/smoke.k6.js --env BASE_URL=http://localhost:5001

# Full baseline
k6 run loadtests/baseline.k6.js --env BASE_URL=http://localhost:5001

# Flash-sale spike (needs a product id and, optionally, a consumer JWT)
k6 run loadtests/spike.k6.js \
  --env BASE_URL=http://localhost:5001 \
  --env PRODUCT_ID=1 \
  --env CONSUMER_TOKEN=<jwt>

# Webhook flood
k6 run loadtests/webhook-flood.k6.js --env BASE_URL=http://localhost:5001

# Socket storm
k6 run loadtests/socket-storm.k6.js --env BASE_URL=ws://localhost:5001
```

## Reading results

k6 prints a summary at the end of each run.  Key metrics to watch:

- `http_req_duration` p50/p95/p99 — latency distribution
- `http_req_failed` — 4xx/5xx rate (we threshold at < 1 %)
- `negative_stock_detected` (spike test) — must be 0
- `connect_errors` (socket storm) — must be < 5 %

## Promoting to nightly

Add a `.github/workflows/load-nightly.yml` that runs on `schedule: cron` and
calls the full suite.  The `load-smoke` CI job already runs `smoke.k6.js` on
every PR.
