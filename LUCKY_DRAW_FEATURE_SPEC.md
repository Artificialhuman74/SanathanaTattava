# Consumer Lucky Draw Scheme — Feature Spec

This document is the source of truth for the new consumer-facing "lucky draw"
loyalty scheme on SanathanaTattva. It was built up through a Q&A/ideation
session — nothing described here has been implemented yet. Hand this file to
Claude verbatim to start execution; do not re-litigate the decisions in §3
without the user's explicit say-so.

**Status: SPEC ONLY. Nothing in this document has been built. Frontend/UX
design for the trader and admin views (§8–9) is still being discussed —
do not design or build those screens until that conversation concludes.**

---

## 1. Product summary

Admin creates and launches "schemes" (Scheme 1, Scheme 2, ...) that consumers
can opt into. On enrollment, the consumer picks a free 200ml "welcome gift"
product. Once enrolled, a consumer becomes eligible for a **monthly lucky
draw** by making at least one purchase that month. If they win, they get the
product from their qualifying purchase delivered free for every remaining
month of the scheme. If the scheme ends (12 months) and they never won, they
get a guaranteed free delivery of their most recent purchase in the 13th
month. The system must support several schemes running concurrently, but a
given consumer can only ever be enrolled in one scheme at a time. Chance to
win should scale up gradually for loyal (repeat) buyers.

This is a **temporary/promotional feature**, not a permanent platform
capability — see §10 for how that constrains the build.

**Working name: "Bhagya Chakra"** — not yet confirmed, see §11.

---

## 2. Domain glossary

- **Scheme** — an admin-created, admin-configured lucky draw campaign with
  its own 12-month lifecycle, enrollment window, and requirements. Multiple
  schemes can exist and run at the same time.
- **Enrollment** — a consumer joining a specific scheme. Requires paying the
  joining fee and picking a welcome gift. Only possible during that scheme's
  signup window.
- **Welcome gift** — a free 200ml product the consumer picks for themselves
  at the moment of enrollment. One-time, separate from the monthly reward
  mechanic below. See §7.
- **Qualifying purchase** — any purchase (any product, any amount — no
  minimum) a consumer makes in a given calendar month while enrolled. Having
  one in a given month = an entry into that month's draw.
- **Reward item** — the product (and quantity) from the consumer's *most
  recent* qualifying purchase. There is no "pick 1 product at signup" step —
  it's always whatever they bought last.
- **Draw** — the monthly random selection of one winner per scheme, held on
  the 12th of every month at 5PM IST.
- **Win** — from the month they win onward, the consumer gets their reward
  item delivered free (₹0 order) every month until the scheme ends. They
  drop out of the draw pool for that scheme once they've won (hard limit of
  1 win per scheme).
- **Guarantee payout** — if a consumer is still enrolled at the end of the
  scheme's 12 months and never won, they get one free delivery of their most
  recent qualifying purchase in month 13.
- **Joining fee** — flat ₹100, charged per scheme, at enrollment.
- **Loyalty weighting** — a consumer's odds of winning the monthly draw
  should increase the more of a repeat/loyal buyer they are. Exact formula
  TBD — see §12.

---

## 3. Decisions (settled — do not re-litigate)

| # | Decision |
|---|---|
| 1 | Schemes are admin-managed entities (Scheme 1, Scheme 2, ...). Admin sets requirements and controls when a scheme goes live. |
| 2 | The system must support **multiple schemes running concurrently**. This is not a singleton "current scheme" design. |
| 3 | A consumer can only join a scheme during that scheme's **signup/enrollment window at launch**. Once that window closes, latecomers cannot join that scheme even if it still has months left. |
| 4 | A consumer can only be enrolled in **one scheme at a time, system-wide**. If they try to join a second scheme while already active in one, they are blocked. |
| 5 | "Active in a scheme" covers **both** states: still trying to qualify each month, *and* already won and receiving post-win free deliveries. Either way, they're locked out of joining anything else until their current scheme's full period is over. |
| 6 | Eligibility per month = **any purchase that month**, any product, no minimum amount or quantity. |
| 7 | The reward item is **never chosen upfront**. It is always whatever the consumer's most recently qualifying purchase was — this applies to a monthly win *and* to the 13th-month guarantee payout. |
| 8 | Scheme runs for a **fixed period of 12 months**. |
| 9 | Missing a month's qualifying purchase costs the consumer **that month's draw entry only** — they stay enrolled and can qualify again the next month. |
| 10 | Draw is held on the **12th of every month at 5PM IST**. Qualifying purchase for that draw must be made by the **10th** of the month. |
| 11 | **One winner per scheme per month.** |
| 12 | On winning: the consumer keeps placing a **₹0 order** each month for the reward item (same product/qty as the winning purchase) for the rest of the scheme. This is an action they take (an order gets placed), it's just priced at ₹0 — not a silent/automatic shipment with zero consumer involvement. |
| 13 | Once won, **no real qualifying purchase is required** to keep receiving the free item — winning itself is what keeps the ₹0 order path open for the remaining months. Hard limit: 1 win per scheme; they drop out of that scheme's draw pool after winning. |
| 14 | 13th month: anyone still enrolled at month 12 who never won gets **one free delivery** of their most recent qualifying purchase. |
| 15 | Joining fee is a flat **₹100**, charged **per scheme** — re-charged every time a consumer joins a new scheme (not a one-time platform fee). |
| 16 | Consumer-facing UI must show **eligibility status (eligible / not eligible)** each month, with exception handling for edge cases (e.g., mid-cycle joins, missed months, scheme just ended). |
| 17 | Loyal / repeat buyers should have **gradually increasing odds** of winning the monthly draw. Exact weighting formula is not yet decided — see §12 for candidate approaches, needs a decision before implementation. |
| 18 | A new **200ml product size** exists, with **no container deposit/charge** (unlike the 2.8L/5L steel-container sizes). |
| 19 | At enrollment, the consumer **picks which 200ml product they want** as a one-time free welcome gift — this is separate from the monthly reward-item mechanic (§7). |
| 20 | The welcome gift is fulfilled like a normal order (routed to the consumer's dealer/trader for delivery), and that **trader receives a notification** to fulfill it. |
| 21 | Traders need a **visual view of their own linked consumers'** lucky-draw status: enrolled/not, eligible this month/not, won/still trying/completed. |
| 22 | Admin needs the **same visualization aggregated across all traders**, grouped/filterable by trader. |
| 23 | Admin needs **manual control** over the scheme even though qualification checks and the draw itself run automatically — exact control surface TBD, see §9. |
| 24 | This is a **temporary/promotional feature**. Must be built so it can be cleanly disabled or removed later without invasive changes scattered across core checkout/order/notification code — see §10. |

---

## 4. Scheme lifecycle

```
   ┌───────────┐   admin sets requirements,
   │  draft    │   launch date, joining fee
   └─────┬─────┘
         │ admin publishes
         ▼
   ┌───────────────────┐   consumers can enroll
   │ enrollment open    │   (pay ₹100 joining fee,
   └─────┬──────────────┘    pick 200ml welcome gift)
         │ signup window closes (admin-defined)
         ▼
   ┌───────────────────┐   month 1 → month 12:
   │     running        │   monthly qualifying purchase window (1st–10th),
   │                     │   draw on 12th, winners peel off into
   │                     │   "won — free monthly delivery" sub-state
   └─────┬──────────────┘
         │ month 12 ends
         ▼
   ┌───────────────────┐   anyone enrolled + never won
   │  month 13 payout   │   gets one free delivery of their
   └─────┬──────────────┘   last qualifying purchase
         ▼
   ┌───────────┐
   │  ended    │   all enrollees free to join a different scheme now
   └───────────┘
```

A consumer's own enrollment record effectively has its own smaller state
machine: `enrolled (qualifying)` → `won (recurring free delivery)` → `scheme
ended`, or `enrolled (qualifying)` → `never won` → `13th month payout` →
`scheme ended`. Either path blocks joining another scheme until "scheme
ended."

---

## 5. Data model sketch (proposal, not yet applied)

```sql
CREATE TABLE lucky_draw_schemes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,               -- "Scheme 1", "Scheme 2"...
  status            TEXT NOT NULL DEFAULT 'draft',-- draft | enrollment_open | running | ended
  joining_fee       DECIMAL NOT NULL DEFAULT 100,
  enrollment_opens_at  DATETIME,
  enrollment_closes_at DATETIME,
  starts_at         DATETIME,                    -- month 1 start
  ends_at           DATETIME,                     -- month 12 end (computed: starts_at + 12mo)
  created_by        INTEGER REFERENCES users(id), -- admin
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lucky_draw_enrollments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id         INTEGER NOT NULL REFERENCES lucky_draw_schemes(id),
  consumer_id       INTEGER NOT NULL REFERENCES consumers(id),
  status            TEXT NOT NULL DEFAULT 'active', -- active | won | guaranteed_payout | completed
  joining_fee_paid  DECIMAL NOT NULL,
  enrolled_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  welcome_gift_product_id INTEGER REFERENCES products(id),
  welcome_gift_order_id   INTEGER REFERENCES consumer_orders(id),
  won_at_month      INTEGER,                      -- 1-12, NULL if never won
  reward_product_id INTEGER REFERENCES products(id), -- snapshot: last qualifying purchase's product
  reward_quantity   INTEGER,
  UNIQUE(consumer_id, scheme_id)
  -- Application-level invariant: a consumer may only have ONE row across ALL
  -- schemes with status IN ('active','won') at a time. Enforce in service
  -- layer (SQLite has no partial-unique-index-across-tables), and cover with
  -- the concurrency test in §6.
);

CREATE TABLE lucky_draw_monthly_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id     INTEGER NOT NULL REFERENCES lucky_draw_enrollments(id),
  month_number      INTEGER NOT NULL,             -- 1-12
  qualifying_order_id INTEGER REFERENCES consumer_orders(id), -- NULL = missed this month
  qualified         BOOLEAN NOT NULL DEFAULT 0,
  is_winner         BOOLEAN NOT NULL DEFAULT 0,
  draw_run_at       DATETIME,
  UNIQUE(enrollment_id, month_number)
);
```

Loyalty-weighting inputs (whatever §12 lands on — e.g. count of prior
qualifying months, prior schemes completed, lifetime order count) can be
computed from existing tables (`consumer_orders`, `lucky_draw_enrollments`)
at draw time rather than stored redundantly, unless performance dictates
otherwise.

**Open detail:** how 200ml SKUs fit the existing `products` table — presumed
to be new rows per existing oil (coconut/etc.) at `unit='200ml'`,
`container_type=NULL`, `container_cost=0`, but not yet confirmed against the
real schema.

---

## 6. Reward mechanics detail

- Winning month's qualifying purchase (product + quantity) is snapshotted as
  the `reward_product_id` / `reward_quantity` on the enrollment.
- Every subsequent month until the scheme ends, the consumer places an order
  for that same product/quantity, priced at ₹0.
- No further real purchase is required to keep this going — it continues
  automatically as long as they place that ₹0 order each month.
- **Open detail:** what happens if the consumer doesn't place the ₹0 order
  in a given month — do they just miss that month's free delivery, or does
  it forfeit the rest of the reward? Needs a decision before implementation
  (default assumption, pending confirmation: same as a missed qualifying
  month — they just miss that month, reward continues next month).

---

## 7. Welcome gift (200ml)

- New product size: **200ml**, no container deposit (unlike 2.8L/5L).
- At enrollment, the consumer chooses which 200ml product they want as a
  **one-time free gift** — independent of the monthly qualifying-purchase /
  reward-item mechanic in §6.
- Fulfilled like a normal order: routed to the consumer's linked/assigned
  dealer for delivery, priced at ₹0.
- The fulfilling trader gets a **dedicated notification** for it (this is
  the "first 200ml delivery" notification referenced in §8).
- **Open detail:** is the welcome gift limited to products the consumer's
  linked dealer actually stocks, or can they pick from the full catalog
  (with delivery/inventory routed however normal orders are)?

---

## 8. Trader-facing requirements

1. **Welcome gift notification.** When a consumer under this trader enrolls
   in a scheme and picks their 200ml welcome gift (§7), the trader gets
   notified to fulfill/deliver it — same notification infrastructure as
   existing dealer notifications (`NotificationBell` `variant="dealer"`,
   `/api/notifications/dealer`).
2. **Lucky draw visibility, visualized.** A dedicated view, scoped to *this
   trader's own linked consumers only* (consistent with how the rest of the
   trader portal is scoped today), showing per consumer:
   - Enrolled in a scheme, or not
   - Eligible for *this month's* draw or not (made a qualifying purchase yet
     this cycle)
   - Currently winning (getting free monthly deliveries) vs. still trying to
     qualify vs. completed via the 13th-month guarantee vs. not enrolled
   - Should read at a glance — status chips/badges and/or a progress
     indicator ("qualified N of 12 months"), not a dense data table.

   **Frontend/UX design for this view is still to be discussed — see the
   status note at the top of this document. Do not build yet.**

---

## 9. Admin-facing requirements

1. **All trader-wise consumer eligibility, same visualization.** The admin
   version of §8.2, aggregated across the whole platform, grouped/filterable
   by trader — admin can drill from "everyone" down to one trader's
   consumers and see the same eligible/not-eligible visualization.
2. **Manual control over the scheme**, on top of the automatic qualification
   checks and monthly draw. Candidate control surface (needs confirmation,
   not all of this may be wanted):
   - Create/configure a scheme (name, requirements, joining fee, enrollment
     window) — already covered by §1/§3.
   - Pause or end a scheme early.
   - Live stats: current enrollment count, how many have qualified so far
     this month, countdown to the next draw.
   - Manually trigger/re-run a specific month's draw as a fallback.
   - Possibly void/reassign a winner in an exceptional case.

   **Frontend/UX design for this view is still to be discussed — see the
   status note at the top of this document. Do not build yet.**

---

## 10. Architecture requirement: temporary, removable feature

This is a **limited-time promotional feature**, not a permanent platform
capability. The build must make it easy to disable or delete cleanly once
the promotion ends, without archaeology through unrelated core files.

*(My reading of "use SOLID principles to make this not present easily" is
"make it easy to make this feature go away later" — flagging that
interpretation for confirmation, since the phrasing could also have meant
something about UI prominence instead.)*

Practical shape:
- **Isolated module.** Own DB tables (§5), own service layer (e.g.
  `backend/src/services/luckyDraw/`), own route file(s) (e.g.
  `backend/src/routes/luckyDraw.js`), own frontend feature folders per role
  (e.g. `pages/consumer/luckyDraw/`, `pages/trader/luckyDraw/`,
  `pages/admin/luckyDraw/`).
- **Single Responsibility.** Draw logic, eligibility computation, enrollment
  rules, and notification dispatch live in separate, narrowly-scoped
  services — not bolted onto existing order/checkout services.
- **Open/Closed.** Integrate with the existing checkout/order flow through a
  narrow extension point (e.g. an event/hook fired after a qualifying order
  is placed) rather than editing `POST /consumer/orders` directly with
  lucky-draw-specific conditionals sprinkled through it.
- **Dependency inversion where it matters.** The lucky-draw service depends
  on small, focused interfaces (e.g. "a way to send a notification," "a way
  to look up a consumer's linked dealer") rather than reaching directly into
  unrelated modules' internals.
- **Payoff:** turning this off later should mean deleting a handful of
  self-contained files and reverting a couple of single-line hook
  registrations — not surgery scattered across `checkout.js` /
  `consumer.js` / `notifications.js`.

---

## 11. Naming

User wants a name for the scheme that fits the SanathanaTattva brand
(cold-pressed oils, wooden ghani, heritage/traditional feel, Sanskrit-rooted
brand name). Candidates, not yet decided:

| Name | Rationale |
|---|---|
| **Bhagya Chakra** *(recommended)* | *Chakra* = wheel — a direct callback to the ghani's own rotating stone/pole, the brand's most distinctive visual. *Bhagya* = luck/fortune, understood across Hindi/Kannada/Sanskrit. Reads as "the wheel of fortune," which is literally what's spinning either way. |
| Tattva Bhagya | Pairs directly with the existing "Sanathana **Tattva**" brand name. Reads as "the essence of fortune." |
| Ghani Draw | Simple, literal, safe — lowest risk, least distinctive. |
| Lakshmi Chakra | Most emotionally resonant (goddess of fortune/wealth) but a common trope in Indian retail promos — risks feeling generic rather than distinctive to this brand. |

**Needs a decision from the user.**

---

## 12. Open design question: loyalty-weighted odds

User's requirement: *"the loyal buyers should gradually get more chance to
win the lucky draw."* Not yet defined precisely. Candidate approaches to
choose between (or combine) before implementation:

- **A — Streak-based, within-scheme.** Odds increase with consecutive
  qualifying months in the *current* scheme (e.g. month 1 = 1 ticket, month
  6 streak = 2 tickets, month 10 streak = 3 tickets). Resets each scheme.
- **B — Lifetime purchase history, platform-wide.** Odds weighted by total
  historical orders/spend on SanathanaTattva, independent of any one scheme.
  Rewards long-time customers regardless of scheme streak.
- **C — "Pity" mechanic across schemes.** Consumers who enrolled in past
  schemes and never won get a boost the next time they enroll.
- **Simplest implementation shape regardless of formula chosen:** classic
  raffle-ticket model — loyalty score converts to N tickets in that month's
  draw pool, draw picks one ticket at random. Easy to reason about, easy to
  test statistically (see §6/§13).

**Needs a decision from the user before this part gets built.**

---

## 13. Testing requirements (to be built — not built yet)

Per explicit request, build a dedicated test file covering the concurrency
scenario end-to-end:

1. **Multiple concurrent schemes.** Scheme 1 and Scheme 2 both `running` at
   the same time, each with their own enrollees, independent monthly draws,
   independent winners. Confirm no cross-talk between them (e.g. a draw on
   Scheme 1 never touches Scheme 2's entries).
2. **Blocked second enrollment.** A consumer enrolled and `active` in
   Scheme 1 attempts to enroll in Scheme 2 → must be rejected.
3. **Blocked while in post-win state.** A consumer who already `won` in
   Scheme 1 (still receiving free monthly deliveries) attempts to enroll in
   Scheme 2 → must also be rejected (per Decision #5 — "active" includes the
   post-win tail, not just the qualifying phase).
4. **Unblocked after scheme ends.** Once Scheme 1 reaches `ended` for that
   consumer (either via the 13th-month payout or simply running out its 12
   months post-win), the same consumer can now successfully enroll in
   Scheme 2.
5. **Missed-month behavior.** Consumer skips month 3's qualifying purchase,
   confirm they lose only month 3's draw entry and are still active/eligible
   for month 4 onward.
6. **One winner per scheme per month**, verified across a scheme with many
   enrollees.

Separately, set up a **test environment for the loyalty-weighting mechanic**
once §12 is resolved: simulate a large number of draws across consumers with
varying loyalty scores and statistically verify that higher-loyalty
consumers win proportionally more often than a flat/uniform random draw
would produce, without ever guaranteeing a win outright (still a lucky
draw, just weighted).

---

## 14. Other open details flagged during spec-writing

- 13th-month guarantee: does it apply to anyone still enrolled at month 12
  regardless of how many individual months they missed (current assumption,
  since a missed month only costs that month's entry per Decision #9), or
  does it require a full unbroken 12-month qualifying streak?
- Reward continuation if the consumer skips placing a ₹0 order in a given
  post-win month (see §6).
- Can the admin end/cancel a scheme early? What happens to active
  enrollments and paid joining fees if so?
- Is the ₹100 joining fee refundable under any circumstance (e.g. admin
  cancels the scheme before it starts)?
- Exception-handling cases for the eligibility display (Decision #16) —
  what specific edge cases need explicit messaging (mid-cycle join attempt
  blocked, already-active-elsewhere block, scheme not yet started, etc.)?
- Is the welcome gift limited to the consumer's dealer's stock, or the full
  catalog (§7)?
- Exact admin control surface (§9.2) — confirm which controls are actually
  wanted vs. assumed.

---

## 15. Explicit non-scope for this pass

Nothing in this document has been implemented. No migrations, routes,
services, frontend components, or test files exist yet for this feature.
Trader and admin frontend/UX (§8–9) specifically still need a design
conversation before any screens get built. This spec is meant to be handed
back for execution in a future session.
