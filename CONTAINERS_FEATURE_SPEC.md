# Consumer Containers Feature — Full Spec

This document is the source of truth for the new consumer-facing container management feature on SanathanaTattva. Hand it to Claude verbatim at the start of any new session to skip re-discovery.

---

## 1. Product summary

SanathanaTattva sells cold-pressed oils in reusable **steel containers**. Each container carries a refundable deposit. Today the lifecycle is admin-only and operates at invoice level. We are building a consumer self-service experience where users can:

1. See exactly which containers they currently hold.
2. Opt out of a product and get the deposit back (assuming undamaged).
3. Swap a held container for a different product of the same container size (free if same size; pay diff if upgrading; refund diff if downgrading).
4. Re-order a product they already hold the container for, without paying the deposit again ("Refill" path).

The two container sizes in scope are **2.8 L** and **5 L** — both steel.

---

## 2. Domain glossary

- **Container deposit** — refundable amount charged at purchase per physical container. Non-taxable under CGST Act §2(31) Explanation while held. Becomes taxable only on forfeit.
- **Holding** — one steel container currently in a consumer's possession (or in transit to them). One holding = one physical container.
- **Refill** — consumer reorders the same product they already hold the container for. No new deposit charged. Quantity capped by current holdings count.
- **Buy more** — consumer orders units beyond their holdings count. Each new unit charges a fresh deposit.
- **Swap** — consumer reassigns a held container from one product to another product of the same container size. No new deposit if sizes match; pay or get refunded the difference otherwise. (For v1, prices are equal across container size, so swap is always ₹0 — but the code must support a diff to keep the door open for future product-specific deposit amounts.)
- **Forfeit** — container damaged, lost, or not returned. Deposit is kept by the company and a supplementary tax invoice is issued (HSN/rate TBD with CA, see §11).
- **Opt-out** — consumer-initiated refund request. Container is picked up by the delivery agent, inspected, and either refunded or forfeited based on condition.

---

## 3. Current state (what already exists in the codebase)

Files of interest:
- `backend/src/services/containerDepositService.js` — `refundDeposit` and `forfeitDeposit` admin functions. Forfeit issues a supplementary tax invoice (currently HSN 3923 / plastic / 18% — to be corrected for steel).
- `backend/src/services/invoiceService.js` — generates invoice at checkout, line 109 stores `containerDeposit` as a single number per invoice.
- `backend/src/routes/payments.js:244` — invoice generation is triggered immediately on Razorpay payment verification, not on delivery.
- `backend/src/database/migrations.js:619-642` — `invoices.container_deposit` and `container_deposit_status` columns.
- `backend/src/routes/admin.js:655-667` — admin "Container Deposits" page queries.

### Known existing bugs / gaps the new feature must address

1. **Status never flips to `held`.** The migration backfilled existing rows once, but the INSERT in `invoiceService.js` never sets `container_deposit_status`, so new invoices default to `'none'` and stay there. Admin dashboard filter `WHERE container_deposit_status='held'` therefore shows nothing post-migration.
2. **Deposit charged unconditionally on every order.** No check today for whether the consumer already holds a container for that product. Every reorder charges the deposit again.
3. **Aggregate deposit per invoice.** `invoices.container_deposit` is a single number for the whole order, with no per-line breakdown. Cannot refund or swap a single container in a multi-product order.
4. **Forfeit HSN code is wrong for steel.** Currently 3923 (plastic), 18%. Steel kitchen containers are typically HSN 7323 at 12%. Final values pending CA confirmation (see §11).

---

## 4. Decisions (all settled, do not re-litigate)

| # | Decision |
|---|---|
| 1 | Container sizes for v1: `'2.8L'` and `'5L'` (steel). `container_type` is a new TEXT column on `products`. |
| 2 | Status flips to `held` on delivery-confirmed event, not at checkout. Before delivery, holdings exist as `pending_delivery`. |
| 3 | Per-line holdings via a new `container_holdings` table (one row per physical container). The existing `invoices.container_deposit_status` column stays for legacy accounting but is no longer the operational source of truth. |
| 4 | Cross-product offset is **explicit only** — never silent. Consumer must choose Swap (from product page or Containers page) for cross-product reuse. |
| 5 | Pending (undelivered) holdings do NOT count toward Refill cap. Only `held` does. Refill button is hidden if no `held` containers; only "Buy more" shown. |
| 6 | `refund_requested` and `swap_requested` holdings do NOT count toward Refill cap either — those containers are logically leaving the consumer. |
| 7 | Refill cap shown to consumer = `held_count − units_already_in_cart_as_refill` (dynamic). |
| 8 | Cart shows refill and buy-more as **separate line items** even for the same product. E.g., "Sunflower oil 2.8L × 5 (Refill, no deposit)" and "Sunflower oil 2.8L × 2 (with deposit)". |
| 9 | Refill / Buy more / Swap buttons appear on **both** the product detail page and the My Containers page. Product page is discovery; Containers page is management. |
| 10 | Cross-product swap UX: on a product page (e.g. coconut 2.8L), if consumer holds a different-product container of the same size (e.g. sunflower 2.8L), show a "Swap your sunflower container for coconut (₹0 deposit)" button alongside Refill (greyed because product differs) and Buy more. |
| 11 | Refund destination is consumer choice at request time: (a) manual bank refund handled by admin (UTR recorded) OR (b) store credit wallet usable on any future order. Razorpay auto-refund not required — manual is fine. |
| 12 | Damage inspection happens at pickup by the **delivery agent**, who flips status to `refunded` or `forfeited` from the delivery app. Delivery agent needs a new pickup-inspection UI. |
| 13 | Empty state for My Containers page: "You currently hold no containers yet." Shown both for new customers and for customers whose orders are still in transit. |
| 14 | Quantity-aware deposit logic is uncapped — rule is `deposits_charged = max(0, new_qty − offset_count)`. No magic number 5. |
| 15 | Partial deliveries are out of scope (per user: won't happen). |
| 16 | Cancelled-at-door deliveries: consumer pre-paid, so they keep the order and refund the container separately if they want — no special-case handling needed. |

---

## 5. Data model changes

### 5.1 New column on `products`

```sql
ALTER TABLE products ADD COLUMN container_type TEXT;
-- Allowed values: '2.8L', '5L'. NULL for products that don't have containers.
-- Validated in application code; SQLite has no native enum.
```

### 5.2 New table `container_holdings`

```sql
CREATE TABLE container_holdings (
  id                   INTEGER  PRIMARY KEY AUTOINCREMENT,
  consumer_id          INTEGER  NOT NULL REFERENCES consumers(id),
  invoice_id           INTEGER  NOT NULL REFERENCES invoices(id),
  order_item_id        INTEGER  REFERENCES consumer_order_items(id),
  original_product_id  INTEGER  NOT NULL REFERENCES products(id),
  current_product_id   INTEGER  NOT NULL REFERENCES products(id),
  container_type       TEXT     NOT NULL,            -- '2.8L' | '5L'
  deposit_amount       REAL     NOT NULL,            -- original deposit paid, in rupees
  status               TEXT     NOT NULL DEFAULT 'pending_delivery',
  requested_at         DATETIME,                     -- when consumer requested refund/swap
  resolved_at          DATETIME,                     -- when terminal status reached
  resolved_by          INTEGER  REFERENCES users(id),
  notes                TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_holdings_consumer_status ON container_holdings(consumer_id, status);
CREATE INDEX idx_holdings_invoice         ON container_holdings(invoice_id);
```

**Status values:**
- `pending_delivery` — created at order, container not yet delivered to consumer
- `held` — delivered, in consumer's possession; counts toward Refill cap
- `refund_requested` — consumer opted out, awaiting delivery-agent pickup + inspection
- `refunded` — terminal; money refunded (manual bank or store credit)
- `forfeited` — terminal; container damaged or not returned, supplementary invoice issued

Swap does NOT add a new status. On swap, `current_product_id` is rewritten and an audit row is added to `container_swaps`. Status stays `held`.

### 5.3 New table `container_swaps`

```sql
CREATE TABLE container_swaps (
  id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  holding_id      INTEGER  NOT NULL REFERENCES container_holdings(id),
  from_product_id INTEGER  NOT NULL REFERENCES products(id),
  to_product_id   INTEGER  NOT NULL REFERENCES products(id),
  diff_amount     REAL     NOT NULL DEFAULT 0,       -- +ve = consumer paid, -ve = refunded, 0 = even
  diff_payment_id TEXT,                              -- Razorpay payment id if diff > 0
  triggered_in    TEXT     NOT NULL,                 -- 'checkout' | 'containers_page'
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.4 New table `consumer_store_credit_ledger`

Append-only ledger. Balance is derived as `SUM(delta)` per consumer.

```sql
CREATE TABLE consumer_store_credit_ledger (
  id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  consumer_id  INTEGER  NOT NULL REFERENCES consumers(id),
  delta        REAL     NOT NULL,                    -- +ve = credit added, -ve = redeemed
  reason       TEXT     NOT NULL,                    -- 'container_refund' | 'order_redemption' | 'admin_adjustment' etc.
  source_type  TEXT,                                 -- 'container_holding' | 'consumer_order' | ...
  source_id    INTEGER,
  created_by   INTEGER  REFERENCES users(id),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_store_credit_consumer ON consumer_store_credit_ledger(consumer_id);
```

### 5.5 Backfill

For every existing `invoices` row with `container_deposit > 0` AND `container_deposit_status='held'`, create matching `container_holdings` rows (one per delivered container, derived from `consumer_order_items`). Status = `held` so existing holdings show up in the new UI immediately.

### 5.6 Legacy column

`invoices.container_deposit_status` stays. It is no longer authoritative but the old admin Container Deposits page can keep reading from it for backwards compat. New code must use `container_holdings`.

---

## 6. Lifecycle rules

### 6.1 Creation
- On order placement / payment verification, the existing invoice flow continues unchanged.
- **New:** for each order line item where `products.container_type IS NOT NULL` AND a deposit was charged for that unit, insert one `container_holdings` row per unit with `status='pending_delivery'`.
- **New:** for each order line item where the consumer chose **Refill** (no deposit), no holdings rows are created — that order line consumes existing `held` holdings without creating new ones. (The holdings stay held; nothing changes for them.)

### 6.2 Delivery confirmation
- When delivery is marked `delivered`, flip all `pending_delivery` holdings for that order to `held`.
- The delivery app already has a "mark delivered" action — hook in here.

### 6.3 Refill cap at checkout / on product page
- `refillCap(consumerId, productId)` = `count(holdings WHERE consumer=? AND current_product_id=? AND status='held') − units_in_cart_for_this_product_as_refill`
- If `refillCap > 0`, show Refill button with `max = refillCap`. Else hide Refill.
- Buy more button always available, charges deposit per unit.

### 6.4 Cross-product swap (offered from product page)
- If consumer holds a container of the same `container_type` but different `current_product_id`, show a "Swap your [other product] container for [this product]" CTA.
- Clicking it stages a swap; if `diff_amount > 0`, consumer pays the diff at checkout; if `< 0`, gets refunded.
- For v1, deposit amounts are uniform per container size, so `diff_amount` is always 0. The code must still handle non-zero for future-proofing.

### 6.5 Opt-out (consumer-initiated refund)
- Consumer clicks Opt out on a specific holding from the My Containers page.
- Holding status flips `held → refund_requested`. `requested_at` set.
- Consumer picks refund destination at request time: manual bank OR store credit wallet.
- The system creates a pickup task for the delivery agent on next delivery to that consumer (or a standalone pickup if no upcoming delivery — admin-coordinated).

### 6.6 Pickup + inspection (delivery agent)
- Delivery app pickup-inspection screen shows pending pickups per consumer.
- Per container: agent selects **Undamaged → Refund** or **Damaged → Forfeit**, plus optional notes.
- Undamaged → holding status flips `refund_requested → refunded`. Refund is queued:
  - If consumer chose store credit: insert ledger row `+deposit_amount, reason='container_refund'`.
  - If consumer chose manual bank: create an admin task; admin records UTR after bank transfer, then closes the task.
- Damaged → holding status flips `refund_requested → forfeited`. Existing `containerDepositService.forfeitDeposit` runs to issue the supplementary tax invoice. **TODO:** update HSN/rate to steel before this ships.

### 6.7 Swap
- From Containers page or product page, consumer chooses target product.
- Validations: target product has same `container_type` (or different size with a defined diff price), holding is `status='held'` (not requested for refund).
- Update `container_holdings.current_product_id` to target product. Insert `container_swaps` audit row.
- If diff > 0, gate the swap behind successful Razorpay payment of the diff. If diff < 0, queue the diff as a refund (same routing as opt-out: manual or store credit). For v1, diff is always 0.

### 6.8 Refill at checkout
- Refill line items in the cart do NOT charge deposit and do NOT create new holdings rows.
- They DO need backend validation at order-placement time: re-check `refillCap` server-side and reject the order if cap is exceeded (someone else's session, stale page, etc.).

---

## 7. UI surfaces

### 7.1 Product detail page (consumer)
- Refill button: visible only if `refillCap > 0`. Quantity selector capped at `refillCap`.
- Buy more button: always visible if product has a container.
- Cross-product swap CTA: visible if consumer holds a same-size container of a different product. Clicking opens a small confirmation modal explaining the swap.

### 7.2 Cart (consumer)
- Refill and Buy more lines for the same product appear separately with distinct labels.
- Consumer can edit or remove either independently.
- Cart total reflects deposit only for Buy more lines.

### 7.3 My Containers page (consumer)
- Empty state: "You currently hold no containers yet."
- One card per `held` holding showing: product name, container size, deposit paid, date received.
- Per-card actions: **Opt out** (refund) and **Swap**.
- Section at bottom or in a tab for in-flight requests (`refund_requested`) and history (`refunded`, `forfeited`).

### 7.4 Inventory admin (admin)
- Product create/edit form: container_type dropdown with `'2.8L'`, `'5L'`, and `None`.

### 7.5 Delivery agent app
- New pickup-inspection screen. List of containers to pick up at the current delivery address.
- Per container: Undamaged / Damaged radio + notes field + submit.

### 7.6 Admin overview
- Container holdings dashboard: filter by status, consumer, container_type.
- Refund task queue: pending manual-bank refunds awaiting UTR entry.
- Manual override: force-resolve a stuck holding.

### 7.7 Store credit wallet (consumer)
- Balance shown on profile / checkout.
- Toggle at checkout: "Apply store credit (₹X available)" — reduces order total up to the credit balance.
- Ledger view: list of credits added and redemptions.

---

## 8. API surface (sketch — names will firm up in implementation)

Backend (all under `/api/consumer` unless noted):

- `GET  /containers` — list of held holdings + grouped counts + in-flight requests
- `GET  /containers/eligibility?product_id=` — `{ refill_cap, swap_candidates: [{ holding_id, from_product }] }` for product page
- `POST /containers/:holding_id/refund-request` — body: `{ destination: 'manual'|'store_credit' }`
- `POST /containers/:holding_id/cancel-request` — only if status still `refund_requested`
- `POST /containers/:holding_id/swap` — body: `{ to_product_id, triggered_in }`. Returns diff amount + payment intent if needed.
- `GET  /store-credit` — balance + ledger
- `POST /store-credit/apply` — at checkout, attach credit to a pending order

Delivery agent (under `/api/delivery`):

- `GET  /pickups?consumer_id=` — pending pickup inspections
- `POST /pickups/:holding_id/inspect` — body: `{ outcome: 'undamaged'|'damaged', notes }`

Admin (under `/api/admin`):

- `GET  /container-holdings` — paginated, filterable
- `POST /container-holdings/:id/manual-refund` — body: `{ utr, notes }`
- `POST /container-holdings/:id/override-status` — emergency manual override

---

## 9. Phased implementation plan

Each phase ends with a review checkpoint. Do not start the next phase until the previous one is reviewed.

**Phase 1 — Foundation migrations + types**
- Migrations: `products.container_type`, `container_holdings`, `container_swaps`, `consumer_store_credit_ledger`.
- Backfill `container_holdings` from existing `held` invoices.
- TypeScript / shared types for new tables.
- No behavior changes yet. Verify with migration smoke test.

**Phase 2 — Holdings lifecycle backend**
- Hook into order placement to create `pending_delivery` holdings rows.
- Hook into delivery-confirmed event to flip `pending_delivery → held`.
- New helpers: `getHeldContainers(consumerId)`, `getRefillCap(consumerId, productId, cartReservedQty)`.
- Update checkout deposit calculation to honour refill lines.

**Phase 3 — Inventory admin**
- Container-type dropdown on product create/edit form.
- Backfill existing products with appropriate container_type values (admin task).

**Phase 4 — Consumer product page**
- Refill / Buy more / Swap CTAs.
- Cart logic: separate line items for refill vs buy-more.

**Phase 5 — My Containers page**
- List view, empty state, per-card actions.
- Opt-out and Swap modal flows.
- Refund destination selector (manual vs store credit).

**Phase 6 — Delivery agent inspection UI**
- Pickup list per consumer.
- Per-container undamaged/damaged inspection action.
- Triggers refundDeposit or forfeitDeposit in the existing service.

**Phase 7 — Store credit wallet + refund routing**
- Wallet balance + ledger view.
- Admin manual-refund task queue with UTR entry.
- Apply-credit toggle at checkout.

**Phase 8 — Admin oversight**
- Holdings dashboard.
- Manual override and audit trail.

---

## 10. Edge cases settled

- Multiple identical containers → per-holding row, not per-product aggregation.
- In-transit holdings → `pending_delivery` status, hidden from Refill/Opt-out/Swap.
- Refund processing window — irrelevant since refunds are manual or store credit, not Razorpay auto-refund.
- Damage verification → delivery agent inspects at pickup, marks outcome from delivery app.
- Concurrent refund + swap on same holding → DB-level guarded update (`WHERE status='held'`, check `changes()`).
- Refill cap stays accurate when consumer adds more to cart in a second session → server-side re-check at order placement.
- Cancelled-at-door order → not a special case; container refund is a separate flow.
- Partial deliveries → out of scope per user.

---

## 11. Open TODOs

1. **GST / HSN code for steel containers on forfeit.** Currently `containerDepositService.js` line 22 hardcodes `DEFAULT_FORFEIT_TAX_RATE = 18` (HSN 3923, plastic). Steel kitchen containers are typically HSN 7323 at 12%, but pending CA confirmation. Leave a `TODO(steel-hsn)` comment in code and patch when confirmed.
2. **Deposit amounts per container size.** v1 assumes uniform per size — confirm the actual ₹ value used in checkout flow today and decide whether to hardcode in a config or store per-product.
3. **Pickup task scheduling.** When the consumer requests opt-out but has no upcoming delivery to their address, how is the pickup scheduled? Phase 6 design decision — likely admin-coordinated for v1.

---

## 12. Hand-off notes

- The user is the founder of SanathanaTattva (`users.id=2`, email `barathichiru@gmail.com`).
- Production DB is on Railway volume `/data/database.db`; access via `railway ssh` + `better-sqlite3` (no `sqlite3` binary).
- Project context lives in `CLAUDE.md` at the repo root — read that first.
- Codebase uses SQLite + Express + Socket.IO on backend; React + Vite + Tailwind on frontend.
- All new migrations go in `backend/src/database/migrations.js` following the existing additive pattern (`hasColumn` checks).
- The user prefers phased delivery with review checkpoints — do not bundle multiple phases into one commit unless explicitly asked.
