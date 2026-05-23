# TradeHub — Edge-Case Testing Plan

A categorized roster of edge-case tests to harden the platform. Each part is
self-contained: invoke Claude with `do part N` and it'll implement that block
end-to-end (tests + CI wiring + sanity run).

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Part 1 — Money & precision  `[x]`

Where rupees go wrong. Floats, rounding, sign errors, partial refunds.

- Commission `amount = total × rate / 100` rounded to paise (₹0.01 unit)
- Commission on a ₹0.99 order × 7% rate (sub-paise rounding)
- Tier-2 override commission stacks correctly on top of tier-1 direct
- Refund > captured payment → 400, never partial-overcharge
- Refund of an already-refunded order → 400 (idempotent)
- Negative / zero `amount` rejected at all entry points (refund, restock,
  order item, commission insert)
- `NaN` / `Infinity` / non-numeric strings on numeric fields → 400
- `weekly_payouts.total_amount` matches `SUM(commissions.amount)` after partial
  reversals

**Files:** `backend/tests/money.test.js`, `backend/tests/commissions.test.js`

---

## Part 2 — Race conditions & concurrency  `[x]`

The bugs that don't reproduce locally.

- Two parallel `processing` transitions on same order — only one deducts stock
- Two parallel orders deplete dealer stock past zero → second one 400s
- Webhook arrives before client `verify` callback (idempotency by
  `razorpay_payment_id`)
- Replay same `payment.captured` event twice → no double commission insert
- `payment.failed` after `payment.captured` for same order → no double restore
- Concurrent inventory restore (cancel + refund + webhook all fire) → flag
  prevents double-add
- Sweeper sees an order mid-payment → respects payment_status check

**Files:** `backend/tests/concurrency.test.js`, `backend/tests/webhook.test.js`

---

## Part 3 — Auth, authz & cross-tenant  `[x]`

Privilege escalation, token confusion, tenant boundaries.

- Consumer JWT on `/api/admin/*` → 403
- Consumer JWT on `/api/trader/*` → 403
- Trader JWT on `/api/admin/*` → 403
- Admin JWT on `/api/consumer/*` → 403
- Tier-2 sub-dealer hitting `/api/trader/sub-dealer-commissions` → 403
- Tier-1 A acting on tier-1 B's sub-dealers or commissions → 404 (not 403,
  to avoid leaking existence)
- Expired JWT → 401
- Malformed JWT (`Bearer foo.bar`) → 401
- Missing `Bearer` prefix → 401
- JWT signed with wrong secret → 401
- `role` claim tampered (re-signed with test secret as consumer claiming
  admin) — server must re-fetch user from DB and reject if role mismatches

**Files:** `backend/tests/authz.test.js`

---

## Part 4 — State-machine guards  `[x]`

Illegal transitions.

- Cancel an already-delivered order → 400
- Refund a refunded order → 400
- Refund a non-paid order → 400
- Confirm a commission twice via token → 400
- Dispute a commission that's already confirmed → 400
- Log payment on a commission already `awaiting_confirmation` → idempotent
  (regenerates token only if expired)
- Backward status moves (`processing → pending`) → 400
- Cancel a `pending` order with no inventory deduction → still 200, no restore

**Files:** `backend/tests/state-machine.test.js`

---

## Part 5 — Public-token endpoints  `[x]`

The commission confirmation flow lives outside auth.

- Expired token (14-day window) → returns `{ expired: true }`
- Token consumed (status='paid' or 'disputed') → success state, no double-fire
- Tampered / random token → 404
- Missing `token` query param → 400
- Dispute reason > 1000 chars → truncated or 400
- XSS in dispute reason (`<script>`) — stored escaped, rendered safe in email
- Confirming after disputing → 400
- Disputing after confirming → 400

**Files:** `backend/tests/public-commission.test.js`

---

## Part 6 — Razorpay webhook  `[x]`

The most chaotic surface.

- Missing `x-razorpay-signature` → 400
- Bad signature → 400
- Valid signature but unknown event type → 200 (no crash, logged)
- `payment.captured` for unknown `order_id` → 200, no DB write
- `payment.failed` triggers `returnOrderInventory` (uses new flag)
- `refund.processed` updates `refund_status` on correct order
- `transfer.processed` updates correct commission
- Webhook body modified after signing → 400
- Replay same `event.id` twice — no double-credit (needs event_id dedupe
  table; flag as missing if not implemented)

**Files:** `backend/tests/webhook.test.js`

---

## Part 7 — Input validation & injection  `[x]`

Boundaries.

- SQL string in name (`Robert'); DROP TABLE users;--`) stored verbatim,
  query parameterized
- Stored XSS in product name / address / dispute reason — server stores raw,
  frontend must escape
- Oversized payload (>10 MB) → 413
- Unicode / emoji in name fields preserved end-to-end
- Negative quantity in restock / order item → 400
- Zero quantity in order item → 400
- `NaN` / `Infinity` in quantity → 400
- Pincode regex (6 digits) — `'12345'`, `'1234567'`, `'abcdef'` all rejected
- Email format — `'foo@'`, `'foo@bar'`, `'@bar.com'` rejected
- IFSC regex — `'SBI'`, `'sbin000123'`, `'XXXX0123456'` boundary
- Account number regex — `'12345678'` (8), `'1234567890123456789'` (19) reject

**Files:** `backend/tests/validation.test.js`

---

## Part 8 — Frontend critical paths (Vitest)  `[x]`

- `ConfirmCommission` page — render loading / expired / confirmed / disputed
- `PrivateRoute` redirects unauthenticated → `/login`
- `PrivateRoute` redirects wrong role → role's home
- `ConsumerRoute` redirects unauthenticated → `/shop/login`
- `DeliveryRoute` redirects non-trader → `/delivery/login`
- `api` axios interceptor: 401 → `/login` (not `/shop/login`)
- `consumerApi` axios interceptor: 401 → `/shop/login` (not `/login`)
- `NotificationBell` — sound toggle persists to localStorage
- Bank details form — IFSC regex / account number regex client-side validation

**Files:** `frontend/src/__tests__/pages/*.test.tsx`

---

## Part 9 — E2E (Playwright)  `[ ]`

Full user journeys.

- Consumer signup → browse → checkout → mock-pay → order shows in trader's list
- Trader marks order `processing` → dealer_inventory drops
- Admin cancels paid order → refund issued + inventory restored
- Tier-1 marks sub-dealer commission paid → confirmation email sent
  (snapshot the link) → sub-dealer confirms via link → status becomes `paid`
- Tier-1 marks sub-dealer commission paid → sub-dealer disputes → admin
  notification created
- Abandoned-order sweeper: create order, don't pay, fast-forward → cancelled

**Files:** `e2e/*.spec.ts`

---

## Part 10 — CI gate hardening  `[x]`

What CI itself should check beyond unit tests.

- `npm audit --audit-level=high` for backend and frontend (warn, not block)
- Migration smoke test: spin up a fresh SQLite DB, run all migrations,
  assert every expected table + column exists
- ESLint step for backend (currently none)
- Reject PRs whose diff drops backend coverage below an agreed floor
  (e.g. 70%)
- Build a `seed-and-smoke` job: seed DB, hit `/api/health` + 3 critical
  endpoints, assert 200
- Add a `secret-scan` step (gitleaks or `git-secrets`) to catch checked-in
  `.env`, JWT secrets, Razorpay keys
- Make E2E job blocking (currently `continue-on-error: true`) once stable

**Files:** `.github/workflows/ci.yml`, `backend/tests/migration-smoke.test.js`

---

## Part 11 — Performance, load & spike  `[x]`

The Amazon-grade question: what happens at 10×, 50× normal traffic? Flash
sales hit the same 2–3 product pages, not the whole catalog.

- Baseline: average daily load (e.g. 50 RPS for 5 min) — record p50/p95/p99
  latency for `/api/consumer/shop`, `/api/payments/verify`,
  `/api/consumer/orders`
- 10× sustained (Black-Friday simulation) for 10 min — no 5xx, p99 < 2s
- 50× spike on a single product page in 30 s (flash sale) — verify dealer
  inventory never goes negative, two simultaneous "last unit" orders only
  one succeeds, the other gets 409 (or 400) with a clear message
- Checkout-only soak: 100 concurrent `verify` calls — no commission
  duplicated, no double-deduct, sweeper unaffected
- Webhook flood: 1 000 `payment.captured` events back-to-back — idempotency
  table keeps growing linearly, no double-credit
- Socket.IO connection storm: 500 clients connect within 5 s — no
  memory leak (RSS stable after disconnect)

**Files:** `loadtests/*.k6.js` (new dir), CI job `load-smoke`
**Tools:** k6 (free, scriptable in JS, fits CI). Run a tiny smoke run on PRs,
full runs nightly.

---

## Part 12 — Catalog & cart UX  `[ ]`

The boring stuff that bites you the most.

- Shop filter: by category / pincode / availability — empty state renders
  cleanly when 0 matches
- Sort: price asc / desc / newest — stable order with ties
- Pagination / infinite scroll: doesn't refetch the same page, doesn't lose
  scroll position on back nav
- Add to cart from product card without opening detail → cart count +1
- Remove last item from cart → empty state, not a blank page
- Quantity stepper: min 1, max = dealer stock, no zero, no negatives
- Cart persists across browser refresh (localStorage)
- Cart syncs across tabs via `storage` event (already wired for socket — same
  pattern for cart)
- Cart with a since-deleted/soft-deleted product → removed gracefully with toast
- Coupon / discount math: applied → re-applied → removed leaves total at base
- Address selector: 0 addresses → "add first address" prompt, not a crash
- Search box with `'`, `"`, `<script>`, emoji, 500-char input → safe

**Files:** `frontend/src/__tests__/pages/Shop.test.tsx`, `cart.test.ts`,
`e2e/cart-flow.spec.ts`

---

## Part 13 — Accessibility (WCAG 2.2 AA)  `[ ]`

95.9% of e-commerce sites fail WCAG. Accessible sites have a 23% cart
abandonment rate vs 69% for inaccessible — this is revenue.

- `axe-core` scan on every public route — 0 critical/serious violations
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text
- Every interactive element keyboard-reachable in logical tab order
- Focus ring visible on all interactive controls
- All `<img>` have meaningful `alt` (or `alt=""` if decorative)
- Form fields have associated `<label>` (not just placeholder)
- Error messages are programmatically associated with inputs
  (`aria-describedby`)
- Modal dialogs trap focus, return focus on close, dismiss on `Esc`
- Toasts use `role="status"` or `aria-live="polite"`
- Skip-to-content link on every page
- No keyboard traps (testable with `axe` + Playwright Tab loop)
- Touch targets ≥ 44×44 px on mobile

**Files:** `e2e/a11y.spec.ts` (Playwright + `@axe-core/playwright`)
**CI:** add as a non-blocking check first; promote to required after we
clear the initial violations.

---

## Part 14 — SEO & meta  `[ ]`

Organic traffic = free customers. Don't ship pages with `<title>Vite App</title>`.

- Every public page has a unique `<title>` and `<meta name="description">`
- Canonical URL set on Landing, Shop, product detail pages
- Open Graph + Twitter card tags on Landing, Shop
- `robots.txt` present and sane (no accidental `Disallow: /`)
- `sitemap.xml` generated or stubbed
- Heading hierarchy: exactly one `<h1>` per page, no skipped levels
- Image `loading="lazy"` below the fold, `width`/`height` to prevent CLS
- 404 page returns HTTP 404, not 200 (current SPA fallback returns 200 — flag)
- Structured data (`Product`, `Organization`) on relevant pages

**Files:** `e2e/seo.spec.ts`, `frontend/src/__tests__/seo.test.tsx`

---

## Part 15 — Internationalization & locale  `[ ]`

We're Bangalore-first (INR, IST, English) but money/time bugs are universal.

- All ₹ formatting uses `toLocaleString('en-IN', …)` and shows 2 decimals
  even for whole rupees (`₹1,000.00` not `₹1000`)
- Lakh/crore grouping (`1,00,000` not `100,000`) on amount displays
- Phone input accepts `+91 9XXXXXXXXX` and bare 10-digit, rejects others
- Pincode is exactly 6 digits, leading-zero safe (`560001` not `560,001`)
- All server timestamps stored as UTC, rendered in IST on the frontend
- Server uses `datetime('now')` consistently — no `new Date()` strings that
  drift on DST or non-IST hosts
- Commission `week_start` / `week_end` align with Monday→Sunday in IST,
  even when server is UTC and "today" is Sunday 23:00 IST (= Monday 00:00 UTC)
- Email/SMS templates use IST in the body, never raw ISO strings
- Character encoding: emoji + Devanagari (हिन्दी) in name/address survive
  round-trip through DB, email, push notification

**Files:** `backend/tests/locale.test.js`, `frontend/src/__tests__/format.test.ts`

---

## Part 16 — Real-time & Socket.IO  `[ ]`

Notifications, order updates, dealer alerts — all real-time.

- Socket auth fails with bad JWT → disconnects cleanly, no crash
- Socket reconnects after network drop (Socket.IO native, but verify it picks
  up the same user_id)
- New notification fires `notification` event to correct room (dealer / admin /
  consumer) and not to others
- Order status change fires `order_update` to consumer + linked dealer +
  delivery dealer — exactly once each
- Server restart: clients reconnect, missed events are caught up via REST
  fetch on mount (already wired; assert the call happens)
- Bell wiggle + chime + browser push fire on `notification` event
- Sound toggle off → no Web Audio call
- Push permission denied → silent fallback, no crash, banner stays

**Files:** `backend/tests/socket.test.js`,
`frontend/src/__tests__/components/NotificationBell.test.tsx` (extend existing)

---

## Part 17 — Notification deliverability & idempotency  `[ ]`

Don't email a customer 3 times because Resend retried.

- `sendOrderConfirmationEmail` called once per order, even if the verify
  endpoint is hit twice (dedupe by `payment_status='paid'` guard exists —
  test it)
- `sendCommissionConfirmationEmail` called once per `log-payment`, even if
  the parent dealer hits the button twice
- Resend HTTP 429 → backoff + retry, never throws to the caller
- Resend HTTP 5xx → logged and silently dropped (don't fail the order)
- Notification table grows linearly (no duplicate rows for the same event)
- Consumer OTP: rate-limited to N requests per hour per phone/email
- Password reset token single-use, expires after T minutes
- Email verification token single-use, expires after T hours
- Dispute notification sent to: parent dealer + ALL active admins (not just
  one) — assert recipient count

**Files:** `backend/tests/notifications.test.js`,
`backend/tests/email-idempotency.test.js`

---

## Part 18 — Data integrity & disaster recovery  `[ ]`

When the laptop running production dies, what happens?

- All foreign keys honored: no `consumer_order_items.order_id` pointing to a
  deleted order, no `commissions.trader_id` pointing to a deleted user
- Cascade rules: deleting a soft-deleted trader doesn't orphan their
  commissions
- Migration smoke test: spin up empty DB, run all migrations in order, assert
  every expected table + column + index exists
- Backup script (cron'd) writes a copy of `database.db` to disk; restore drill
  reads it into a fresh dir and the app still boots
- SQLite WAL checkpoint runs at least once per hour (verify by file mtime
  drift)
- Razorpay key id/secret never written to logs, even on error
- JWT secret rotation works: old tokens become invalid, new logins succeed
- `git` history has no leaked `.env`, no `RAZORPAY_KEY_SECRET=`, no JWT secret
  (run `gitleaks` in CI — also in Part 10)

**Files:** `backend/tests/integrity.test.js`, `scripts/backup.sh`,
`scripts/restore-drill.sh`

---

## Part 19 — Observability & ops  `[ ]`

You can't fix what you can't see.

- `/api/health` returns `{ status: 'ok', db: 'ok' }` and actually pings the DB
- 503 returned when DB file is unreachable
- Every request gets a `X-Request-ID` (uuid) propagated to logs
- Error responses include request id for grep-ability
- Structured JSON logs in production (so a log aggregator can parse them)
- Slow query log: SQLite statements > 100 ms get warned
- No `console.log` left in hot paths (replace with leveled logger)
- Process exits with code 1 on uncaught exception (so PM2 / Railway restarts)
- Graceful shutdown on SIGTERM: stop accepting new requests, drain in-flight,
  close DB

**Files:** `backend/src/middleware/requestId.js`,
`backend/tests/observability.test.js`, optional `scripts/log-tail.sh`

---

## Part 20 — Compliance & legal  `[ ]`

Indian DPDP Act 2023 + Razorpay rules.

- No card numbers, CVV, or expiry stored anywhere (Razorpay-hosted checkout)
- Consumer data export endpoint (`GET /api/consumer/me/export`) returns all
  PII associated with the consumer
- Consumer "delete my account" soft-deletes (keeps order history with PII
  redacted) — verify orders still computable for tax
- Privacy policy + Terms of service routes exist and are linked in footer
- Cookie consent banner on first visit (if we add any analytics cookies)
- Audit log on admin actions: trader approval, refund issued, payout marked
  paid — who, when, what changed
- Sensitive endpoints (refund, payout, linked-account) require admin auth +
  log a structured audit event

**Files:** `backend/src/middleware/auditLog.js`,
`backend/tests/compliance.test.js`, `frontend/src/components/CookieBanner.tsx`

---

## Conventions

- All new backend tests use the existing `helpers/factory.js` for setup and
  `helpers/app.js` for the supertest instance.
- Each test file calls `clearAll()` in `beforeEach` for isolation.
- Frontend tests use the existing `src/__tests__/setup.ts` and Vitest globals.
- Every new test must run green in CI before merging.
- When implementing a part, **also tick its checkbox** in this file in the
  same commit.
