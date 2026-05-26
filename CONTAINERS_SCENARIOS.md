# Containers Feature — Full Scenario Test Plan

End-to-end scenarios for the steel-container deposit/refill/swap/refund feature.
Walks every actor (consumer / Razorpay / invoice engine / notifications / linked
dealer / delivery / admin) and the state machine in between. Use this as a
manual QA script and as a reference for what *should* happen at each step.

---

## 0. Setup checklist (do once before testing)

1. **Products configured.** In Admin → Inventory, at least two oil products
   share a `container_type` of `2.8L` and at least one has `5L`. Each must have
   a non-zero `container_deposit` (e.g. ₹150 for 2.8L, ₹250 for 5L).
2. **Consumer is linked to a dealer.** `consumers.linked_dealer_id` must point
   at an active trader. The dealer is who picks up the empties — *no matter
   how far away they are*. There is no nearest-dealer routing for returns.
3. **Test consumer has a default address.** Otherwise the dealer pickup email
   will say "address not on file".
4. **Resend/email creds are set** (`RESEND_API_KEY`) — emails fail open
   (logged, not thrown), so the UI succeeding does *not* prove email worked.
   Verify in inbox or in `[email]` log lines.
5. **Notifications mock is OFF in dev.** It's auto-mocked in Jest only.

> **Sizes are not interchangeable.** A `2.8L` deposit can refill or swap into
> another `2.8L` product, never a `5L`. Mixed-size swaps are explicitly
> rejected at the service layer.

---

## 1. The lifecycle in one picture

```
       ┌────────────────────┐
       │ pending_delivery   │  ← createHoldingsForInvoice (on payment confirm)
       └─────────┬──────────┘
                 │ markHoldingsDelivered (on delivery OTP verify)
                 ▼
       ┌────────────────────┐
       │       held         │  ◄────── cancelRefund
       └─────────┬──────────┘     │
                 │ requestRefund  │
                 ▼                │
       ┌────────────────────┐    │
       │ refund_requested   │────┘
       └─────────┬──────────┘
                 │ finalizeRefund (dealer or admin at pickup)
                 ▼
        ┌──────────┴───────────┐
        ▼                      ▼
   refunded              forfeited
 (store credit or       (damaged / missing,
  manual bank flag)      deposit kept by us)
```

Status values live in `container_holdings.status`. They are the spine of
everything below.

---

## 2. Consumer: building a cart with NEW vs REFILL lines

### 2.1 First-time buy (NEW container)

**Example:** Brand-new customer adds *Sunflower Oil 2.8L* (deposit ₹150,
oil price ₹600) with `mode='buy'` and quantity 2.

| What you should see | Where |
|---|---|
| Cart line shows an amber `NEW` badge and `+₹300.00 container deposit` | Shop / Cart |
| Subtotal = ₹1200 (oil) + ₹300 (deposit) = ₹1500 | Checkout summary |
| GST applies to the ₹1200 portion only, deposit is **not taxable** | Invoice |
| Razorpay total includes the deposit | Razorpay modal |

**What I think happens behind the scenes:**
- `consumer_order_items.is_refill = 0`, `container_cost = 150` per unit.
- After payment, `createHoldingsForInvoice` inserts **2 rows** into
  `container_holdings`, status `pending_delivery`, one per unit.

### 2.2 Refill order (no deposit)

**Pre-req:** the consumer already has at least 1 **held** 2.8L container
(see §6 for how to get there).

**Example:** Same consumer opens the same product on Shop. Because they
hold a 2.8L container, a `REFILL` chip appears next to `NEW`. They tap
REFILL, set qty=1.

| What you should see | Where |
|---|---|
| `REFILL` chip is enabled and selected (emerald) | Shop |
| Cart shows a green `REFILL` badge, **no deposit line** | Cart / Checkout |
| Subtotal = ₹600, no ₹150 added | Checkout |
| Invoice item line ends with `(Refill)` | Invoice PDF + email |
| Deposit summary on invoice reads `Refundable Container Deposit (0 × new)` or is omitted | Invoice PDF |

**Refill cap:** the REFILL option is greyed out once you try to refill more
units than you currently hold of that size. `getRefillCap` subtracts already
reserved cart units from your held count.

### 2.3 Mixed cart (some refill + some new)

**Example:** Hold 1 × 2.8L. Order 1 × 2.8L refill + 1 × 2.8L new + 1 × 5L
new. Three separate cart lines: one with REFILL badge (₹0 deposit), one
with NEW badge (₹150), one with NEW badge (₹250).

| Expected | Why |
|---|---|
| Two new `container_holdings` rows created at payment confirm: one 2.8L, one 5L | The refill line has `container_cost=0` so it does *not* materialise a holding |
| Invoice "Refundable Container Deposit (2 × new)" total ₹400 | Counts only `!is_refill && container_type` lines |

### 2.4 Edge: refill mode picked but no held containers

Should be impossible from the UI (chip disabled), but if a client tampers
with the payload and posts `is_refill=true` for a product they don't have
a holding for, **inventory will be charged but no deposit is collected** —
that's a known leak. v1 accepts it; v2 should enforce `getRefillCap` server-side.

---

## 3. Razorpay payment flow

### 3.1 Happy path

**Example:** Consumer clicks "Pay" on the checkout with a ₹1500 total.

| Step | Expected |
|---|---|
| `POST /api/payments/create-order` | Returns `razorpay_order_id`, amount in paise (`150000`) |
| Razorpay modal opens, user pays with UPI test creds | Modal closes, frontend posts `razorpay_payment_id`/`signature` to `/verify` |
| Backend verifies HMAC `SHA256(order_id|payment_id, key_secret)` | Match → `consumer_orders.payment_status='paid'`, `status='confirmed'` |
| `generateInvoiceForOrder` is invoked (fire-and-forget) | Tax invoice row + PDF emailed to consumer |
| `createHoldingsForInvoice` runs inside invoice generation | Container holdings rows materialise as `pending_delivery` |
| Notifications fan out | `notifyAdminNewOrder` + `notifyLinkedDealerOrderRouted` |

**What I think happens if HMAC fails:** `/verify` returns 400, order stays
unpaid, *no holdings, no invoice, no notifications*. The consumer sees a
"Payment verification failed" alert.

### 3.2 User closes Razorpay modal

- Frontend never calls `/verify`.
- Order remains `pending_payment` / `payment_status='unpaid'`.
- The webhook safety net (`/api/payments/webhook` on `payment.captured`)
  will flip it to paid if Razorpay confirms the capture independently.

### 3.3 Webhook double-fires (idempotency)

- `razorpay_webhook_events` table dedupes by `x-razorpay-event-id`.
- Second event is silently ignored. **No duplicate holdings, no duplicate
  emails.**

### 3.4 Payment success but invoice generation throws

- Order is still `paid` / `confirmed` (correct — customer paid).
- `[verify] invoice gen failed for ORD-XXXX` logged.
- **Holdings will NOT exist** (they're created inside the invoice flow).
- Recovery: admin re-runs invoice generation; `createHoldingsForInvoice`
  is idempotent so it's safe.

---

## 4. Invoice — tax treatment and line rendering

### 4.1 Reading a "buy" invoice

For 2 × Sunflower 2.8L (₹600 each) + deposit:

```
Sunflower Oil 2.8L              2 × ₹600.00      ₹1200.00
Taxable subtotal                                 ₹1200.00
CGST 9%                                            ₹108.00
SGST 9%                                            ₹108.00
Refundable Container Deposit (2 × new)             ₹300.00
─────────────────────────────────────────────────────────
Total                                            ₹1716.00
```

**Why deposit is below the tax block:** under GST §15 r/w §2(31),
refundable deposits are not "consideration" until forfeited, so they are
not taxable. Once a holding flips to `forfeited`, that's the moment we owe
tax — accounting handles that separately, the invoice doesn't recompute.

### 4.2 Reading a refill invoice

```
Sunflower Oil 2.8L (Refill)     1 × ₹600.00       ₹600.00
Taxable subtotal                                  ₹600.00
CGST 9% / SGST 9%                                 ₹108.00
(no deposit line)
─────────────────────────────────────────────────────────
Total                                             ₹708.00
```

The `(Refill)` suffix and the missing deposit line are how the consumer's
records distinguish a refill from a new purchase.

### 4.3 HSN code note

The HSN code currently shipped is `3923` (plastic packaging). Steel
containers should likely be `7323`. **Pending CA confirmation** before we
change the code. Until then it's a known discrepancy, not a bug to fix
mid-test.

---

## 5. Notifications on order placement (not refund-related)

When payment is verified, three things light up:

1. `notifyAdminNewOrder` → DB notification for every admin + WebSocket
   push → admin bell chimes.
2. `notifyLinkedDealerOrderRouted` → DB notification for the consumer's
   linked dealer + WS push → dealer bell chimes.
3. `notifyConsumerDeliveryAssigned` is fired only after the order is
   actually picked up by a delivery agent.

**Test it:** open `https://sanathanatattva.shop/admin` and the dealer
account side-by-side. Place an order on a third tab. Both bells should
animate and chime within ~1s of payment success.

---

## 6. Getting a container to "held" (so we can test §7–§8)

The only path to `held`:

1. Place a buy order with at least one container_type product.
2. Pay successfully.
3. Delivery agent accepts → packs → marks out_for_delivery.
4. At doorstep, agent runs OTP verification on the consumer's phone.
5. `markHoldingsDelivered(order_id)` flips every `pending_delivery`
   holding for that order to `held`.

**Sanity check:** the consumer's `/shop/containers` page now shows the
container under "Currently held". A `2.8L` REFILL chip becomes selectable
in Shop.

---

## 7. My Containers — refund request

### 7.1 Refund to store credit

**Example:** Consumer opens `/shop/containers`, taps **Return** on a held
2.8L holding, picks "Store credit", types "pickup any evening this week",
submits.

| Expected | Where to check |
|---|---|
| Holding row `status='refund_requested'`, `refund_destination='store_credit'`, `notes='pickup any evening this week'` | `container_holdings` |
| Holding now shows "Refund requested" pill on the consumer page | `/shop/containers` |
| **Linked dealer** gets a bell notification *and* an email | Dealer bell + dealer inbox |
| **All admins** get a bell notification *and* an email | Admin bell + admin inbox |
| Dealer email copy emphasises *pickup regardless of distance* | Email body |
| `notifyContainerRefundRequested` is called with `{ linkedDealerId, holdingId, destination, ... }` | Server log + DB notifications row |

**Why both channels:** the user explicitly required a mail in addition to
in-app push. If the bell rings but no email arrives, the email service
silently failed — check Resend dashboard / server logs.

### 7.2 Refund to manual bank

Same as 7.1 but `destination='manual_bank'`. Email copy hints the dealer
to physically collect and that admin will trigger the bank transfer. **No
store-credit ledger row** will be created later — admin handles the
payout outside the app.

### 7.3 Cancel a refund

Consumer changes their mind → taps "Cancel refund" → `cancelRefund`
restores `status='held'`, clears `refund_destination`, clears
`requested_at`. The pickup task disappears from the dealer's Pickups
page. No email is sent on cancel (deliberate — keeps inboxes quiet).

### 7.4 Invalid destination

Posting `destination='crypto'` → service throws `INVALID_DESTINATION` →
route returns **400**. Only `store_credit` and `manual_bank` are allowed
in v1.

### 7.5 Cross-consumer attack

Consumer A tries to refund consumer B's holding by guessing the ID. The
SELECT is scoped by `consumer_id`, so it returns nothing → route returns
**404 "not found"** (deliberate — don't leak existence).

### 7.6 Refunding a `pending_delivery` holding

If the user finds a way to call refund before delivery is verified, the
service throws `INVALID_STATUS` ("cannot refund from status=pending_delivery").
Route returns **400**. UI should never expose the action while pending_delivery.

---

## 8. My Containers — swap

### 8.1 Same-size swap

**Example:** Consumer holds a 2.8L Sunflower. They tap **Swap product** and
pick *Groundnut Oil 2.8L* from the picker.

| Expected | Where |
|---|---|
| `current_product_id` flips to the new product, `original_product_id` unchanged | `container_holdings` |
| One row inserted into `container_swaps` audit table with from/to product ids | `container_swaps` |
| No new deposit charged | Consumer wallet untouched |
| Holding still appears in `held` | `/shop/containers` |

**Why audit table:** so we can reconstruct the consumer's swap history
even though `original_product_id` only records the *first* product.

### 8.2 Cross-size swap is blocked

Try to swap a 2.8L holding into a 5L product. Service throws
`SIZE_MISMATCH` → **400 "container_type mismatch"**. UI's swap modal
filters to same-size by default, so this is a tamper-only path.

### 8.3 Swap to same product

Service throws `NO_CHANGE`. **400**. Modal should grey out the current
product to prevent the attempt.

### 8.4 Swap while refund_requested

Once a refund is requested you can't swap — the holding is "locked" for
the dealer's pickup. Service throws `INVALID_STATUS`. **400**. UI hides
the Swap button when the status is `refund_requested`.

---

## 9. Delivery agent — order detail

Open `/delivery/orders/:id` for a paid order.

- Each item line shows its product name.
- If the product has a `container_type`, a small chip appears:
  - **`REFILL`** (emerald) for `is_refill=1` lines — agent should *take an
    empty back* and *deliver one filled*. No new container leaves the van.
  - **`NEW`** (amber) for `is_refill=0` lines — agent delivers a fresh
    sealed container.
- Items with no `container_type` (e.g. accessories) show no chip.

**Why this matters operationally:** the agent uses the chip to decide
whether to put a fresh container on the van or just plan a swap at the
doorstep. Without this UI, refill orders would still consume a new
container from inventory.

---

## 10. Delivery agent — Container Pickups tab

A new bottom-nav tab `Pickups` (RotateCcw icon).

### 10.1 What the list shows

`GET /api/delivery/container-pickups` returns every `refund_requested`
holding the dealer is responsible for. Scoping:

- **Trader role** → only holdings whose consumer's `linked_dealer_id`
  equals the dealer's user id.
- **Admin role** → every open pickup across all dealers (oversight view).

Each card shows: consumer name + phone (click-to-call), full address,
holding id, container size, deposit amount, refund destination (`Store
credit` / `Bank refund` badge), and the consumer's notes if any.

### 10.2 Refund outcome (good condition)

**Example:** Dealer arrives, container is clean, lid intact. Tap **Refund**,
type "no damage", **Confirm**.

| Expected | Where |
|---|---|
| `POST /api/delivery/container-pickups/:id/resolve` with `outcome='refunded'` | Network |
| Holding row: `status='refunded'`, `resolved_at=now`, `resolved_by=<dealer.id>`, optional notes saved | `container_holdings` |
| If destination=`store_credit` → **atomic** insert into `consumer_store_credit_ledger` with `delta=+150`, `source_type='container_refund'`, `source_id=<holding_id>` | `consumer_store_credit_ledger` |
| Consumer's store-credit balance jumps by ₹150 (via `getStoreCreditBalance` SUM) | Consumer profile |
| If destination=`manual_bank` → **no ledger row**; the flag is left for admin's payout flow | DB |
| Pickup card disappears from the list (refunded ≠ refund_requested) | Pickups page |

**Atomicity:** the status flip + ledger insert run inside a `db.transaction`.
If the ledger INSERT throws, the status flip rolls back, so you never get
a "refunded" holding with no credit issued.

### 10.3 Forfeit outcome (damaged / missing)

**Example:** Container has a cracked lid. Tap **Forfeit**, type "lid cracked",
Confirm.

| Expected | Where |
|---|---|
| `outcome='forfeited'` posted | Network |
| Holding row: `status='forfeited'`, notes saved | `container_holdings` |
| **No ledger row** — even if destination was `store_credit`. Forfeit means the deposit is ours; this is when GST becomes due | DB |
| Pickup card disappears | Pickups page |

### 10.4 Wrong dealer tries to resolve

Trader B tries to resolve a pickup that belongs to Trader A's consumer →
service `FORBIDDEN` → **403 "only the linked dealer or an admin can
finalize this pickup"**. This is what enforces the "linked dealer
regardless of distance" rule — you can't hand off to a closer dealer
without admin override.

### 10.5 Admin override

Admin opens the same pickup card (visible in admin's pickup list) and
resolves it. Allowed regardless of `linked_dealer_id`. Use case: dealer
unreachable, admin steps in.

### 10.6 Invalid outcome

`outcome='maybe'` or anything other than `refunded`/`forfeited` → **400**
("invalid outcome"). Express-validator + service-layer guard both reject.

### 10.7 Double-resolve

After a pickup is resolved, the card is gone. If the dealer somehow has
a stale URL and POSTs again, the holding's status is no longer
`refund_requested` → service `INVALID_STATUS` → **400**. No duplicate
ledger entry.

---

## 11. Admin views (read-only oversight, mostly)

### 11.1 Admin → Container Deposits page

(Already shipped pre-Phase-6.) Lists holdings by status with consumer +
dealer context. After Phase 6, you should see rows transition from
`refund_requested` → `refunded`/`forfeited` as dealers work through their
pickup lists.

### 11.2 Admin store-credit visibility

Each refunded `store_credit` row is one ledger entry. The consumer's
balance is `SUM(delta)`. Admin should be able to read this on the
consumer profile (if not, that's a v2 UI gap, not a backend bug).

### 11.3 Admin sees all pickups

`/api/delivery/container-pickups` returns the full open list to admins.
Useful when a dealer is unresponsive. From the admin's pickups view (if
exposed in UI; otherwise via the delivery layout while logged in as
admin) they can resolve directly.

---

## 12. Failure modes worth probing manually

| Scenario | Expected behaviour |
|---|---|
| Resend API key invalid | Bell notification still fires; email silently fails (logged). Refund flow is **not** blocked. |
| WebSocket disconnected | Bell still updates on next page load via REST. Sound chime won't play in real-time. |
| Consumer has no linked dealer | Refund request still works (skips dealer notification); only admins are emailed. **This is allowed but flagged in CONTAINERS_FEATURE_SPEC.md as a v1 gap.** |
| Holding's product was deleted | UI may show "Unknown product"; SQL JOINs use LEFT JOIN where it matters. Resolving still works. |
| Multiple holdings of same size, request refund on one | Refill cap drops by 1 immediately because `getRefillCap` only counts `held` rows. |
| Browser back after submitting refund | Page should reflect `refund_requested`; otherwise stale state. |
| Concurrent refund + cancel | Last write wins on DB. Service is single-statement so no half-state. |
| Concurrent two-dealer resolve | Second one hits `INVALID_STATUS` because the first already flipped the status. **400** to the loser. |

---

## 13. Quick-fire checklist (print this and tick it off)

- [ ] Buy 2 × 2.8L new → 2 holdings, status `pending_delivery`
- [ ] Deliver + OTP verify → 2 holdings, status `held`
- [ ] Refill chip appears + cap=2 in Shop
- [ ] Refill 1 × 2.8L order → 1 holding consumed off cap, no new holding
- [ ] Invoice for refill says "(Refill)" + no deposit line
- [ ] Request refund (store_credit) → dealer email + admin email + both bells
- [ ] Dealer Pickups tab shows the card with phone + address
- [ ] Cancel refund → card gone, holding back to `held`
- [ ] Request refund again, dealer taps Refund → status `refunded` + ₹150 credit visible
- [ ] Repeat with manual_bank → no credit, admin sees flag
- [ ] Forfeit path → status `forfeited`, no credit even on `store_credit` destination
- [ ] Same-size swap reassigns `current_product_id`, audit row exists
- [ ] Cross-size swap blocked with `container_type mismatch`
- [ ] Trader B forbidden from resolving Trader A's pickup (403)
- [ ] Admin override resolves any pickup

---

## 14. What is intentionally NOT in v1

Mention these to QA so they don't file them as bugs:

1. **Cross-size swap with delta payment** — out of scope; will land in v2
   with a payment intent.
2. **Container condition photos** at pickup — agent records text notes
   only; photo upload deferred.
3. **Per-holding interest / time decay** — deposits don't accrue.
4. **Automatic ageing of held containers** — no nag if a holding stays
   `held` for months.
5. **HSN code 7323** — still on 3923 pending CA sign-off.
6. **Server-side refill cap enforcement during checkout** — UI restricts,
   server trusts the flag in v1.

---

_Generated for Phase-5/Phase-6 acceptance. Run through this end-to-end on
the staging tunnel before any prod cut. Report any actual-vs-expected
divergence per scenario number._

---

## Phase 7 — Store credit wallet + manual-refund settlement

Phase 7 adds a consumer-facing wallet (refunds with `destination=store_credit`
land here as a positive ledger entry) and an admin queue for the `manual_bank`
refunds that need a UTR stamped after an out-of-band transfer.

Backend pieces:
- New columns: `consumer_orders.store_credit_applied`, plus
  `container_holdings.manual_refund_utr / manual_refund_paid_at / manual_refund_paid_by`.
- New service: [storeCreditService.js](backend/src/services/storeCreditService.js)
  exporting `getBalance`, `getAvailableBalance`, `getLedger`, `applyStoreCredit`,
  `getPendingManualRefunds`, `settleManualRefund`.
- New routes:
  - `GET /api/consumer/store-credit` — `{ balance, ledger }`
  - `GET /api/admin/manual-refunds` — pending payout queue
  - `POST /api/admin/manual-refunds/:holdingId/settle` — stamp UTR
- POST `/api/consumer/orders` accepts `store_credit_to_apply`; capped at
  `min(requested, availableBalance, gross-1)` so Razorpay always sees ≥ ₹1.
- `/api/payments/verify` writes the negative ledger row inside the same
  transaction as the `payment_status='paid'` flip — atomicity guarantee.
- `invoiceService` now computes `totalAmount = taxable + tax + deposit`
  (not `order.total_amount`), so applying credit doesn't break invoice integrity.

Frontend pieces:
- New mobile-first page: [Wallet.tsx](frontend/src/pages/consumer/Wallet.tsx)
  at `/shop/wallet`. Emerald gradient hero + balance + earned/used strip,
  "how it works" card, quick-action tiles, filterable transaction list.
- Containers page shows a slim wallet pill (balance + "View" chevron) that
  links to the dedicated wallet page.
- Checkout: when a logged-in consumer has wallet > 0, a card appears with an
  "Apply ₹X from my wallet" toggle. The summary row and Pay button
  immediately reflect the post-credit total.
- Admin Manual Refunds page at `/admin/manual-refunds` with consumer info,
  linked dealer, deposit amount, and a Settle modal that requires a UTR
  (≥ 4 chars) and an optional internal note.
- New nav links in `ConsumerLayout` (menu drawer) and `AdminLayout` (sidebar).

### 15. Setup for Phase 7 scenarios

You need a consumer who has already received a refund into store credit and one
manual_bank refund pending admin settlement.

1. Run Phase 5 §7-A flow (consumer requests refund with `destination=store_credit`).
2. Dealer marks it refunded via the delivery pickup screen (Phase 6).
3. In a separate flow, request another refund with `destination=manual_bank`;
   dealer marks it refunded too. This one waits on admin UTR entry.

Expected DB state after step 2:
```
SELECT consumer_id, delta, reason, source_type
  FROM consumer_store_credit_ledger;
-- one row with delta > 0, source_type='container_refund'
SELECT balance FROM (SELECT SUM(delta) AS balance
  FROM consumer_store_credit_ledger WHERE consumer_id=?);
-- equals deposit_amount of the refunded holding
```

Expected after step 3:
```
SELECT id, status, refund_destination, manual_refund_utr
  FROM container_holdings WHERE status='refunded' AND refund_destination='manual_bank';
-- manual_refund_utr IS NULL → this row is in the admin queue
```

### 16. Consumer wallet page — happy path

**Action:** Logged-in consumer opens hamburger → **My Wallet**.

**Expected:**
- Emerald gradient hero shows balance (e.g. `₹150.00`) in 5xl bold.
- Stats strip shows **Total earned** = sum of positive deltas, **Total used** = sum of |negative deltas|.
- "How it works" panel explains the wallet in one paragraph.
- Two quick-action tiles: **Shop now** → `/shop`, **My containers** → `/shop/containers`.
- Transaction list shows one row per ledger entry, most-recent first:
  - Positive entry: green ArrowDownCircle, "Container refund · {IST date}", `+₹150.00`
  - Negative entry: grey ArrowUpCircle, "Used at checkout · {IST date}", `−₹50.00`
- Filter pill "All / Added / Used" switches the visible rows.

### 17. Wallet refresh button

**Action:** Tap the refresh icon in the hero.

**Expected:**
- Icon spins for the duration of the request.
- Balance + ledger refetched from `GET /api/consumer/store-credit`.
- On 401, consumer is logged out and redirected to `/shop/login`.

### 18. Applying credit at checkout — partial spend

**Setup:** Wallet balance ₹150. Cart: 1× ₹200 product (no container).

**Action:** Open `/shop/checkout`. Scroll to the **Store Credit** card.

**Expected:**
- Card shows "Apply ₹150.00 from my wallet" with available balance "₹150.00".
- Toggle is OFF by default.
- Toggling ON:
  - Summary gains a green "Store credit applied" line: `−₹150.00`.
  - "Payable now" appears below the Total: `₹50.00`.
  - Pay button label updates: `Pay ₹50.00`.

**Then:** Click Pay, complete Razorpay test payment.

**Expected on success:**
- `consumer_orders.total_amount = 50` (the Razorpay charge amount).
- `consumer_orders.store_credit_applied = 150`.
- After `/payments/verify`, a new ledger row: `delta = -150, source_type='order_redemption', source_id=<orderId>`.
- Returning to `/shop/wallet`: balance is now `₹0`, list shows the redemption row.
- Invoice PDF: total = `taxable + tax + deposit` (= gross 200, not 50). Razorpay payment id printed at bottom.

### 19. Applying credit at checkout — credit larger than order

**Setup:** Wallet balance ₹500. Cart: 1× ₹200 product.

**Action:** Toggle "Apply ₹199.00 from my wallet". (Note the help text: "capped at order total minus ₹1".)

**Expected:**
- UI caps the toggle label at `₹199.00`.
- Pay button: `Pay ₹1.00`.
- Server-side: `store_credit_applied = 199, total_amount = 1`.
- Razorpay always sees a non-zero amount. Wallet after verify: `₹500 - ₹199 = ₹301`.

### 20. Applying credit at checkout — credit > available

**Setup:** Wallet balance ₹50. Frontend somehow sends `store_credit_to_apply: 200`.

**Expected:**
- Server clamps to `min(200, 50, gross-1) = 50`.
- Order persists `store_credit_applied = 50`.
- No error returned — the cap is silent and safe. (This is the test
  `clamps to available balance`.)

### 21. Double-spend across abandoned orders

**Setup:** Wallet balance ₹100. Consumer places Order A applying ₹60 but
abandons the Razorpay modal (order stays `payment_status='pending'`).

**Action:** Consumer starts Order B and tries to apply ₹60 again.

**Expected:**
- `getAvailableBalance` returns `100 - 60 = 40` (Order A's reservation).
- Order B's `store_credit_applied` is silently capped at `40`.
- This is the `respects reserved credit on unpaid orders` test.
- **Note**: Order A's reservation is released when it's cancelled
  (`status='cancelled'`) via the Razorpay `ondismiss` cleanup, or when it
  succeeds (`payment_status='paid'`) — in either case the ledger or the
  reservation accounting resolves.

### 22. Payment verification atomicity

**Action:** Complete a Razorpay payment with `store_credit_to_apply > 0`,
but force a server crash between the order-update and the ledger insert.

**Expected:**
- The whole `db.transaction(...)` in `/payments/verify` rolls back.
- `consumer_orders.payment_status` stays `pending`.
- No ledger row is inserted (balance unchanged).
- Consumer can retry payment or the webhook will reconcile.

### 23. Invoice total integrity with credit applied

**Setup:** Order with gross ₹200, store credit ₹150 applied. Razorpay
charges ₹50.

**Expected on `payment.captured`:**
- Invoice row: `total_amount = 200` (gross supply: taxable + tax + deposit).
- PDF totals match invoice row, not Razorpay charge.
- Rationale: store credit is a payment instrument, not a discount on
  consideration. GST §15 calls out the value of supply; the payment
  channel doesn't reduce it.

### 24. Admin manual-refund queue — list

**Action:** Admin opens **Manual Refunds** in the sidebar.

**Expected:**
- List shows one card per `refunded + manual_bank + manual_refund_utr IS NULL` holding.
- Each card: consumer name, phone, default address, container type, deposit amount,
  "picked up by {dealer}" if linked dealer is set, IST refunded-at timestamp,
  optional note italicised.
- Refresh button refetches.
- store_credit refunds and already-settled refunds do **not** appear (regression test).

### 25. Admin manual-refund — settling with UTR

**Action:** Admin clicks **Settle ₹100** on a card. Modal opens.

**Expected:**
- Modal shows consumer name + container_type · ₹amount.
- Yellow info card warns "this action is irreversible".
- UTR input + optional notes textarea.
- **Confirm** button disabled while UTR < 4 chars.
- On submit:
  - Server stamps `manual_refund_utr`, `manual_refund_paid_at` (CURRENT_TIMESTAMP), `manual_refund_paid_by = req.user.id`.
  - Notes (if any) prepended to existing `notes` column with a newline separator.
  - Card disappears from the list (returns 200, parent reloads).

### 26. Admin manual-refund — double-settle (409)

**Action:** Replay the same `POST /admin/manual-refunds/:id/settle` after success.

**Expected:**
- Server returns **409 Conflict** with body `{ error: "already settled with UTR ..." }`.
- Frontend shows a red toast with that message.
- DB row is **not** modified — UTR field remains the original value.

### 27. Admin manual-refund — invalid status (400)

**Setup:** Trader marks a holding `forfeited` or it's still `held`.

**Action:** Try to settle via the API.

**Expected:**
- 400 with `INVALID_STATUS` message: "cannot settle: status=held destination=null".
- No DB changes.

### 28. Admin manual-refund — wrong destination (400)

**Setup:** A refunded holding with `destination=store_credit` (i.e. credit
already in ledger).

**Action:** Try to settle via the API (UI hides it; this is a defensive
test).

**Expected:**
- 400 INVALID_STATUS. Store-credit refunds don't need UTRs — the credit
  IS the refund.

### 29. Trader cannot reach manual-refund routes

**Action:** Trader hits `GET /api/admin/manual-refunds`.

**Expected:**
- 403 Forbidden (requireAdmin middleware).
- Same for `POST .../settle`.

### 30. Wallet entry source mapping

The transaction row's secondary line decodes `source_type` for the user:

| `source_type` value     | Display label        | When written                              |
|-------------------------|----------------------|-------------------------------------------|
| `container_refund`      | Container refund     | `containerHoldingsService.finalizeRefund` with `destination=store_credit` |
| `order_redemption`      | Used at checkout     | `applyStoreCredit` inside `/payments/verify` |
| `admin_adjustment`      | Adjustment           | (Reserved for future admin tooling — not wired in v1) |
| anything else           | shown raw            | unknown source — surface for debugging    |

### 31. Phase 7 quick-fire checklist

Mark each done after observed behaviour matches:

- [ ] Wallet hero balance matches `GET /api/consumer/store-credit` `.balance`
- [ ] Total earned / used totals match ledger arithmetic
- [ ] Filter pill switches the list (All / Added / Used)
- [ ] Container refund into store_credit lands as a positive ledger row
- [ ] Wallet pill on `/shop/containers` links to `/shop/wallet`
- [ ] Checkout "Store Credit" card only renders when wallet > 0
- [ ] Toggle ON updates Pay button label and summary instantly
- [ ] Server caps credit at `gross - 1` (Razorpay always charges ≥ ₹1)
- [ ] Server clamps credit to `availableBalance`
- [ ] Unpaid orders reserve their credit (no double-spend across abandoned carts)
- [ ] `/payments/verify` writes negative ledger row atomically
- [ ] Invoice total stays `taxable + tax + deposit` (not Razorpay charge)
- [ ] Admin Manual Refunds page lists only refunded + manual_bank + no UTR
- [ ] Settling stamps UTR, paid_at, paid_by; card disappears from queue
- [ ] Double-settle returns 409 with the existing UTR in the message
- [ ] Trader denied 403 on admin manual-refund routes

### 32. What is NOT in Phase 7

1. **Admin manual credit grants** — no UI to push positive ledger entries
   for goodwill credits. Use `source_type='admin_adjustment'` later.
2. **Credit expiry** — credit lives forever in v1.
3. **Partial UTR edits** — once stamped, UTR is locked. Mistakes need a
   manual DB fix.
4. **Email/SMS to consumer when refund is settled** — silent UTR stamp;
   the consumer learns via bank SMS from their bank.
5. **Wallet top-up via payment** — wallet only grows from refunds,
   shrinks at checkout.

---

_Phase 7 added 2026-05-26. Run §15–§31 alongside the Phase 5/6 scenarios
for a full Containers regression pass._


## Phase 8 — Admin holdings dashboard, manual override, audit trail

Phase 8 gives the admin a single screen to inspect every container
holding across the platform and override its state when something has
gone wrong on the ground — the consumer hands back the container after
a delivery agent already marked it `forfeited`, a refund was issued to
the wrong destination, or an entire holding needs to be reopened.

Every override writes a row to `container_holdings_audit` so we can
reconstruct who touched what and when, and ledger reconciliation
happens inside the same transaction as the holding update.

### 33. Phase 8 setup

1. Migration creates `container_holdings_audit` (idempotent — re-running
   the migration is a no-op).
2. Backend exposes:
   - `GET  /api/admin/holdings`              — list + status counts
   - `GET  /api/admin/holdings/:id`          — detail + audit timeline
   - `POST /api/admin/holdings/:id/override` — change status / destination / notes
3. Admin sidebar shows **Holdings** under Container Deposits.
4. The page sits at `/admin/holdings`.

### 34. Holdings dashboard — list + filters

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Open `/admin/holdings` | Six status tiles render at top: Total + pending_delivery + held + refund_requested + refunded + forfeited |
| 2 | Counts on each tile | Match `SELECT status, COUNT(*) FROM container_holdings GROUP BY status` |
| 3 | Click a status tile (e.g. "Held") | List re-fetches with `?status=held`; all rows show the chosen status chip |
| 4 | Search for consumer name (or email / phone) | List re-fetches with `?search=…`; only matching rows render |
| 5 | Click the "Total" tile | Status filter clears; full list returns |
| 6 | Resize to mobile (`< sm`) | Table switches to stacked cards; each card still shows status chip + consumer + container type + deposit + dealer |

### 35. Detail drawer — audit timeline

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Click a holding row | Right-side drawer slides in, fetches `/admin/holdings/:id` |
| 2 | Status block | Big chip with the current status; if `refunded` → "Refund destination: Bank transfer / Store credit" and UTR if present |
| 3 | Consumer block | Name + phone (or email fallback) |
| 4 | Linked dealer block | Dealer name or "None" |
| 5 | Invoice block | `invoice_number` from the join, or `—` if invoice was deleted |
| 6 | Audit timeline | One entry per override, newest first; shows before → after status diff, before → after destination diff (if changed), notes, actor name, timestamp |
| 7 | Holding with no overrides | Timeline shows empty state ("No actions yet") |

### 36. Manual override — happy path (held → forfeited)

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | In drawer, click **Apply manual override** | Modal opens |
| 2 | Select `forfeited` from the status grid | "Refund destination" grid does NOT appear (only required for `refunded`) |
| 3 | Type a reason in notes (e.g. "container damaged") | Required — submit disabled until ≥ 1 char |
| 4 | Submit | POST `/admin/holdings/:id/override` with `{new_status:'forfeited', notes:'…'}` → 200 |
| 5 | Drawer refreshes | Status chip flips to `forfeited`; audit timeline gains a new entry |
| 6 | DB check | `container_holdings.status='forfeited'`, `resolved_at` is now, `resolved_by` = admin id; `container_holdings_audit` has a new row with `before_status='held'`, `after_status='forfeited'` |
| 7 | Ledger | `consumer_store_credit_ledger` unchanged (forfeited never touches credit) |

### 37. Manual override — held → refunded + store_credit (positive ledger reconciliation)

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Start with a holding in `held`, deposit ₹250 | Consumer balance = ₹X (whatever it was) |
| 2 | Override to `refunded` + `store_credit` with a note | 200 OK |
| 3 | Inside the same DB transaction, service writes a **positive** ledger row | `delta=+250`, `source_type='container_refund'`, `source_id=holding_id`, `created_by=admin_id` |
| 4 | Consumer balance | Now `X + 250` |
| 5 | Audit row | Records `before_destination=NULL → after_destination='store_credit'` |
| 6 | If the same admin clicks override again with identical fields | Service returns `{ok:true, noop:true}` — no extra ledger row, no extra audit row |

### 38. Manual override — refunded + store_credit → held (negative reversal)

This is the "undo my mistake" path: admin accidentally refunded to
store credit, consumer flags it, admin reverses.

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Holding sits at `refunded` + `store_credit`; consumer balance = ₹200 from this holding | Confirmed via wallet page |
| 2 | Admin overrides back to `held` with a note like "reverting — consumer never returned container" | 200 OK |
| 3 | Service writes a **negative** ledger row | `delta=-200`, `source_type='admin_adjustment'`, `source_id=holding_id`, `created_by=admin_id` |
| 4 | Wallet balance | Now ₹0 (or whatever the pre-credit balance was) |
| 5 | Audit row | `before_status='refunded' → after_status='held'`, `before_destination='store_credit' → after_destination=NULL` |
| 6 | Wallet ledger view shows the negative row as **Adjustment** | Via `sourceLabel()` mapping |

### 39. Manual override — destination swap (manual_bank → store_credit)

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Holding sits at `refunded` + `manual_bank` (admin was about to UTR-stamp it) | In Manual Refunds queue |
| 2 | Admin overrides to `refunded` + `store_credit` | Service detects "was refunded but not to store_credit, now to store_credit" → positive ledger row |
| 3 | Consumer balance | Increases by the deposit amount |
| 4 | Manual Refunds queue | Holding disappears (queue filters on `manual_bank`) |
| 5 | Audit row | `before_destination='manual_bank' → after_destination='store_credit'` |

### 40. Override validation errors

| Input | Server response |
|-------|-----------------|
| `new_status: 'bogus'`                                  | 400 — express-validator rejects unknown enum |
| `new_status: 'refunded'` without `new_destination`     | 400 — service throws `MISSING_DESTINATION` |
| `new_status: 'refunded'`, `new_destination: 'paypal'`  | 400 — `INVALID_DESTINATION` |
| `notes` > 500 chars                                    | 400 — validator length cap |
| Holding id does not exist                              | 404 — `NOT_FOUND` |
| Trader / consumer token                                | 403 — `requireAdmin` middleware blocks |
| No token                                               | 401 — `authenticate` middleware blocks |

### 41. Atomicity — override + ledger reconciliation in one transaction

Service wraps the UPDATE on `container_holdings`, the optional ledger
INSERT, and the audit INSERT in a single `db.transaction(() => {...})`.
If any step throws, all three roll back together. Manually verifiable:

1. Comment out the audit INSERT to force a SQL error.
2. Send a valid override.
3. After the 500, confirm `container_holdings.status` did NOT change
   and no ledger row was added.
4. Restore the audit INSERT.

### 42. Phase 8 quick-fire checklist

- [ ] Admin sidebar shows **Holdings** link
- [ ] Status count tiles match DB GROUP BY exactly
- [ ] Status filter chip narrows the list
- [ ] Search by consumer name / email / phone all match
- [ ] Mobile layout collapses table → cards
- [ ] Detail drawer fetches `/admin/holdings/:id` on click
- [ ] Audit timeline orders newest first
- [ ] No-op override does NOT write an audit row
- [ ] held → forfeited stamps `resolved_at` + `resolved_by`
- [ ] held → refunded + store_credit writes positive ledger row
- [ ] refunded + store_credit → held writes negative `admin_adjustment` row
- [ ] Trader gets 403 on every Phase 8 admin route
- [ ] Validator rejects refunded without destination (400)
- [ ] Missing holding id → 404
- [ ] Pre-existing 739-test backend suite still green (Phase 8 adds 30)

### 43. What is NOT in Phase 8

1. **CSV / Excel export** — list view is on-screen only.
2. **Bulk override** — admin must override one holding at a time.
3. **Search by holding id directly** — search box is consumer-only.
4. **Free-text action types in the audit table** — only `'override'`
   is written today; future actions (e.g. `'refund_reissued'`) would
   need explicit code paths.
5. **Soft-delete / restore** — overrides only mutate state; there is
   no "delete holding" action.
6. **Consumer notification on override** — silent for now; if the
   override flips refund destination, the consumer learns when they
   open the wallet or expect a bank transfer that never arrives.

---

_Phase 8 added 2026-05-26. Run §33–§42 after Phase 7 for a complete
end-to-end Containers regression pass._
