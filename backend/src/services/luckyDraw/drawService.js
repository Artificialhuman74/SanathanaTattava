/**
 * Lucky draw — the monthly cycle.
 *
 * Answers the four questions the consumer-facing UI has to ask every month:
 * which month of the round are we in, is this consumer in this month's draw,
 * what did the last completed draw decide, and (for a winner) has their ₹0
 * reward order for this month been placed yet.
 *
 * Isolated on purpose, same reasoning as schemeService.js and
 * enrollmentService.js (spec §10): the whole feature lives under
 * services/luckyDraw/ and routes/luckyDraw.js so it can be lifted out later.
 * The one thing it reaches into is consumer_orders, and only through the same
 * single-insert shape enrollmentService already uses for the welcome gift.
 *
 * Not built here: the scheduled job that runs the draw on the 12th (spec
 * §15). `runDrawForScheme` below is the decision logic that job will call —
 * today it is reachable only from the dev tools, which is what makes the
 * post-draw UI testable before the scheduler exists.
 */
const db = require('../../database/db');
const { createNotification } = require('../notificationService');
const { generateInvoiceForOrder } = require('../invoiceService');
const { LUCKY_DRAW_NAME } = require('../../config/luckyDraw');

/* Spec §3, as settled with the founder: buying counts right up to the moment
 * the draw runs, and that moment is the admin's to set (default the 12th at
 * 5PM IST). The entry deadline is therefore not a separate date any more.
 * Two dates meant a consumer could buy on the 11th, see the draw run on the
 * 12th and reasonably believe they were in it. */
const DEFAULT_DRAW_DAY = 12;
const DEFAULT_DRAW_TIME = '17:00';
const MAX_DRAW_DAY = 28;             // every month has one; see drawScheduler
const SCHEME_MONTHS = 12;

/* Read straight from settings rather than through drawScheduler, which
 * imports this file: going the other way would close the loop. */
function drawDayAndTime() {
  const row = key => {
    try { return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value; }
    catch { return undefined; }
  };
  const day = parseInt(row('lucky_draw_day') ?? DEFAULT_DRAW_DAY, 10);
  const [h, m] = String(row('lucky_draw_time') ?? DEFAULT_DRAW_TIME).split(':');
  return {
    day: Math.min(Math.max(Number.isFinite(day) ? day : DEFAULT_DRAW_DAY, 1), MAX_DRAW_DAY),
    hour: Math.min(Math.max(parseInt(h, 10) || 0, 0), 23),
    minute: Math.min(Math.max(parseInt(m, 10) || 0, 0), 59),
  };
}

/* The business runs on IST and the draw time is written in IST, but SQLite
 * stores UTC and the server may sit in any zone. Everything below converts
 * explicitly rather than trusting the host clock's locale. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Wall-clock calendar fields as they read on a clock in India. */
function istParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1, // 1-12
    day: shifted.getUTCDate(),
  };
}

/** The UTC instant at which an IST wall-clock time occurs. */
function istInstant(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS);
}

/** 'YYYY-MM' in IST — the key a calendar month is identified by throughout. */
function monthKey(date) {
  const { year, month } = istParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Parse a SQLite timestamp, which is UTC but written without a zone. */
function parseDbDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const d = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s) : new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * This calendar month's entry deadline and draw time, and next month's, all
 * in IST. Next month's are computed here rather than in the browser because
 * "the 12th at 5PM IST" lands on a different calendar day depending on the
 * viewer's own zone, and only this side knows the answer is a fixed IST
 * wall-clock time rather than an offset from now.
 */
function cycleWindow(now = new Date()) {
  const { year, month } = istParts(now);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const { day, hour, minute } = drawDayAndTime();
  const drawAt = istInstant(year, month, day, hour, minute);
  const nextDrawAt = istInstant(nextYear, nextMonth, day, hour, minute);
  return {
    month_key: monthKey(now),
    month_starts_at: istInstant(year, month, 1).toISOString(),
    /* The deadline IS the draw. An order placed a minute before the wheel
     * turns is in that draw; a minute after it, it counts for next month. */
    entry_deadline: drawAt.toISOString(),
    draw_at: drawAt.toISOString(),
    next_entry_deadline: nextDrawAt.toISOString(),
    next_draw_at: nextDrawAt.toISOString(),
    draw_day: day,
    draw_time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * Which month of the round a scheme is in, 1-based. Counted from the scheme's
 * start (falling back to when enrollment closed, then to the enrollment
 * itself) so a mid-round join still reports the round's month, not the
 * consumer's own elapsed months.
 */
function monthNumberFor(scheme, enrollment, now = new Date()) {
  const anchor = parseDbDate(scheme.starts_at)
    || parseDbDate(scheme.enrollment_closes_at)
    || parseDbDate(enrollment.enrolled_at)
    || parseDbDate(enrollment.created_at);
  if (!anchor) return 1;
  const a = istParts(anchor);
  const n = istParts(now);
  const elapsed = (n.year - a.year) * 12 + (n.month - a.month);
  return Math.min(Math.max(elapsed + 1, 1), SCHEME_MONTHS);
}

/** Family-name initial only — the same shape listRecentWinners already uses. */
function privacyName(name) {
  if (!name) return 'A member';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * Does this order count as a qualifying purchase?
 *
 * Spec §3.6: any purchase, any product, no minimum. Three exclusions:
 * unpaid orders (an order placed is not yet a purchase), and the two ₹0
 * lucky-draw orders, which are identified by number prefix. Being given the
 * welcome gift, or receiving last month's reward, is not a purchase, and
 * letting either qualify would put a winner back into a draw they are no
 * longer eligible for (§3.13).
 */
function isQualifyingOrder(order) {
  return !!order
    && order.payment_status === 'paid'
    && order.status !== 'cancelled'
    && order.total_amount > 0
    && !String(order.order_number).startsWith('BCGIFT-')
    && !String(order.order_number).startsWith('BCFREE-');
}

/**
 * Record a paid order against this month's draw entry.
 *
 * This is the write that qualification is built on. It runs the moment an
 * order is confirmed paid, so the entry row exists before the draw needs it
 * rather than being reconstructed from order history at read time. Safe to
 * call on any order: everything that doesn't qualify returns null.
 *
 * The row's `qualifying_order_id` moves to the most recent qualifying order
 * of the month, which is what spec §3.7 snapshots as the reward.
 *
 * Never throws. A lucky-draw bookkeeping failure must not roll back or
 * obscure a confirmed payment, so callers wrap it and carry on.
 */
function recordQualifyingOrder(orderId, nowOverride = null) {
  try {
    const order = db.prepare(`SELECT * FROM consumer_orders WHERE id = ?`).get(orderId);
    if (!isQualifyingOrder(order)) return null;

    // Only people still trying to qualify have an entry to record. Winners
    // are out of the pool for the rest of the round.
    const enrollment = db.prepare(`
      SELECT e.*, s.starts_at, s.enrollment_closes_at, s.status AS scheme_status
        FROM lucky_draw_enrollments e
        JOIN lucky_draw_schemes s ON s.id = e.scheme_id
       WHERE e.consumer_id = ? AND e.status = 'active'
       ORDER BY e.created_at DESC LIMIT 1
    `).get(order.consumer_id);
    if (!enrollment) return null;

    // Dated from the order, not from the clock: a webhook that lands two days
    // late still counts the purchase in the window it was actually made in.
    const placedAt = parseDbDate(order.created_at) || nowOverride || new Date();
    const window = cycleWindow(placedAt);
    if (placedAt > new Date(window.entry_deadline)) return null;   // after the 10th

    const monthNumber = monthNumberFor(enrollment, enrollment, placedAt);

    // A draw that has already run is settled. Adding an entry to it after the
    // fact would rewrite a result people have already been told about.
    const existing = db.prepare(`
      SELECT id, draw_run_at FROM lucky_draw_monthly_entries
       WHERE enrollment_id = ? AND month_number = ?
    `).get(enrollment.id, monthNumber);
    if (existing && existing.draw_run_at) return null;

    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries
        (enrollment_id, month_number, qualifying_order_id, qualified, is_winner)
      VALUES (?,?,?,1,0)
      ON CONFLICT(enrollment_id, month_number) DO UPDATE SET
        qualifying_order_id = excluded.qualifying_order_id,
        qualified = 1
    `).run(enrollment.id, monthNumber, order.id);

    return { enrollment_id: enrollment.id, month_number: monthNumber, order_id: order.id };
  } catch (err) {
    console.error('[lucky-draw] recordQualifyingOrder failed for order', orderId, err.message);
    return null;
  }
}

/** This month's entry row for an enrollment, with the order that earned it. */
function entryFor(enrollmentId, monthNumber) {
  return db.prepare(`
    SELECT me.qualified, me.is_winner, me.draw_run_at, o.order_number
      FROM lucky_draw_monthly_entries me
      LEFT JOIN consumer_orders o ON o.id = me.qualifying_order_id
     WHERE me.enrollment_id = ? AND me.month_number = ?
  `).get(enrollmentId, monthNumber);
}

/**
 * One-time repair for orders paid before entries were being written, and for
 * any the write missed (a crash between payment and bookkeeping). Only ever
 * touches the current month, and never a month whose draw has already run, so
 * it is safe to run on every boot.
 */
function backfillCurrentMonthEntries(now = new Date()) {
  const window = cycleWindow(now);
  const enrollments = db.prepare(`
    SELECT e.*, s.starts_at, s.enrollment_closes_at FROM lucky_draw_enrollments e
    JOIN lucky_draw_schemes s ON s.id = e.scheme_id
    WHERE e.status = 'active'
  `).all();

  let added = 0;
  for (const e of enrollments) {
    const monthNumber = monthNumberFor(e, e, now);
    const existing = entryFor(e.id, monthNumber);
    if (existing && (existing.qualified || existing.draw_run_at)) continue;

    const order = db.prepare(`
      SELECT id FROM consumer_orders
       WHERE consumer_id = ?
         AND payment_status = 'paid' AND status != 'cancelled' AND total_amount > 0
         AND order_number NOT LIKE 'BCGIFT-%' AND order_number NOT LIKE 'BCFREE-%'
         AND created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC LIMIT 1
    `).get(e.consumer_id, sqliteTime(window.month_starts_at), sqliteTime(window.entry_deadline));
    if (!order) continue;

    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries
        (enrollment_id, month_number, qualifying_order_id, qualified, is_winner)
      VALUES (?,?,?,1,0)
      ON CONFLICT(enrollment_id, month_number) DO UPDATE SET
        qualifying_order_id = excluded.qualifying_order_id, qualified = 1
    `).run(e.id, monthNumber, order.id);
    added++;
  }
  return added;
}

/** SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC; match that shape for compares. */
function sqliteTime(iso) {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

/** The most recent draw that has actually been run on this scheme. */
function latestDraw(schemeId) {
  /* Find the most recent draw RUN, not the most recent winner. A month where
   * nobody qualified is still a draw that happened, and looking for
   * is_winner = 1 would silently reach back past it and report the previous
   * month's winner as if they had just been drawn. */
  const run = db.prepare(`
    SELECT me.month_number, me.draw_run_at
      FROM lucky_draw_monthly_entries me
      JOIN lucky_draw_enrollments e ON e.id = me.enrollment_id
     WHERE e.scheme_id = ? AND me.draw_run_at IS NOT NULL
     ORDER BY me.draw_run_at DESC
     LIMIT 1
  `).get(schemeId);
  if (!run) return null;

  const winner = db.prepare(`
    SELECT e.consumer_id, c.name AS consumer_name, p.name AS reward_product_name
      FROM lucky_draw_monthly_entries me
      JOIN lucky_draw_enrollments e ON e.id = me.enrollment_id
      JOIN consumers c ON c.id = e.consumer_id
      LEFT JOIN products p ON p.id = e.reward_product_id
     WHERE e.scheme_id = ? AND me.month_number = ? AND me.is_winner = 1
     LIMIT 1
  `).get(schemeId, run.month_number);

  const ranAt = parseDbDate(run.draw_run_at);
  return {
    month_number: run.month_number,
    month_key: monthKey(ranAt),
    ran_at: ranAt.toISOString(),
    // Null all through when the month drew nobody. The UI reads this as the
    // no-winner outcome rather than as missing data.
    has_winner: !!winner,
    winner_consumer_id: winner ? winner.consumer_id : null,
    winner_display_name: winner ? privacyName(winner.consumer_name) : null,
    reward_product_name: winner ? winner.reward_product_name : null,
  };
}

/** This month's ₹0 reward order, if the winner has already placed it. */
function rewardOrderThisMonth(consumerId, window) {
  return db.prepare(`
    SELECT id, order_number, created_at, delivery_status, updated_at
      FROM consumer_orders
     WHERE consumer_id = ?
       AND order_number LIKE 'BCFREE-%'
       AND status != 'cancelled'
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 1
  `).get(consumerId, sqliteTime(window.month_starts_at));
}

/**
 * Everything the shop front page needs to decide which of its three states to
 * show. Returns null when the consumer isn't in a running scheme, which is the
 * signal to leave the page exactly as it was.
 */
function getConsumerCycle(consumerId, now = new Date()) {
  const enrollment = db.prepare(`
    SELECT e.*, s.name AS scheme_name, s.status AS scheme_status,
           s.starts_at, s.enrollment_closes_at,
           p.name AS reward_product_name
      FROM lucky_draw_enrollments e
      JOIN lucky_draw_schemes s ON s.id = e.scheme_id
      LEFT JOIN products p ON p.id = e.reward_product_id
     WHERE e.consumer_id = ? AND e.status IN ('active','won')
     ORDER BY e.created_at DESC
     LIMIT 1
  `).get(consumerId);
  if (!enrollment) return null;

  const window = cycleWindow(now);
  const scheme = {
    starts_at: enrollment.starts_at,
    enrollment_closes_at: enrollment.enrollment_closes_at,
  };
  const monthNumber = monthNumberFor(scheme, enrollment, now);
  const draw = latestDraw(enrollment.scheme_id);
  const won = enrollment.status === 'won';

  // A winner is out of the draw pool (spec §3.13), so "entered" is only ever
  // asked of someone still qualifying. The answer is the row written when
  // their order was paid, not a fresh scan of their order history.
  const entry = won ? null : entryFor(enrollment.id, monthNumber);

  let reward = null;
  if (won) {
    const placed = rewardOrderThisMonth(consumerId, window);
    reward = {
      product_name: enrollment.reward_product_name,
      quantity: enrollment.reward_quantity || 1,
      won_at_month: enrollment.won_at_month || monthNumber,
      months_remaining: Math.max(SCHEME_MONTHS - monthNumber, 0),
      this_month_ordered: !!placed,
      this_month_order_number: placed ? placed.order_number : null,
      /* Where the delivery has got to. "On its way" is true the moment the
       * order is placed and stays true for ever otherwise, which turns a
       * status into a slogan; the card needs to be able to stop saying it. */
      this_month_delivery_status: placed ? (placed.delivery_status || 'pending') : null,
      this_month_delivered: !!placed && placed.delivery_status === 'delivered',
      this_month_delivered_at: placed && placed.delivery_status === 'delivered'
        ? (parseDbDate(placed.updated_at) || null)?.toISOString() ?? null
        : null,
    };
  }

  return {
    // The shop page keys "has this person watched their win reveal yet" on
    // the enrollment, the same way the lucky draw page does.
    enrollment_id: enrollment.id,
    scheme_id: enrollment.scheme_id,
    scheme_name: enrollment.scheme_name,
    month_number: monthNumber,
    total_months: SCHEME_MONTHS,
    ...window,
    entered: !!(entry && entry.qualified),
    entry_order_number: entry ? entry.order_number : null,
    // What this month's entry is worth, and why. Shown to them: an undisclosed
    // weighting is both a disclosure problem and a dead incentive.
    tickets: won ? 0 : ticketsFor(enrollment.id),
    qualified_months: db.prepare(
      `SELECT COUNT(*) AS n FROM lucky_draw_monthly_entries WHERE enrollment_id = ? AND qualified = 1`
    ).get(enrollment.id).n,
    won,
    latest_draw: draw
      ? { ...draw, is_me: draw.winner_consumer_id === consumerId }
      : null,
    reward,
  };
}

/**
 * Place the winner's ₹0 order for this month (spec §3.12: the reward is an
 * order they place, not a silent shipment). Routed to their dealer exactly
 * like the welcome gift.
 */
function placeRewardOrder(consumerId, now = new Date()) {
  const cycle = getConsumerCycle(consumerId, now);
  if (!cycle || !cycle.won) throw httpError(400, 'No won enrollment to claim a reward on');
  if (cycle.reward.this_month_ordered) {
    throw httpError(409, "This month's free delivery is already on its way");
  }
  if (cycle.reward.months_remaining <= 0) {
    throw httpError(400, 'This round has finished. There are no free deliveries left on it.');
  }

  const enrollment = db.prepare(`
    SELECT e.*, s.name AS scheme_name FROM lucky_draw_enrollments e
    JOIN lucky_draw_schemes s ON s.id = e.scheme_id
    WHERE e.consumer_id = ? AND e.status = 'won'
    ORDER BY e.created_at DESC LIMIT 1
  `).get(consumerId);

  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(enrollment.reward_product_id);
  if (!product) throw httpError(400, 'Your reward item is no longer stocked. Please contact support.');

  const consumer = db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(consumerId);
  const addr = db.prepare(`
    SELECT name, phone, address, pincode, latitude, longitude, h3_index
      FROM consumer_addresses WHERE consumer_id = ?
     ORDER BY is_default DESC, created_at ASC LIMIT 1
  `).get(consumerId) || (consumer.address && consumer.pincode
    ? { ...consumer, latitude: null, longitude: null, h3_index: null }
    : null);
  if (!addr) throw httpError(400, 'Add a delivery address to your account first');

  const linkedDealerId = consumer.linked_dealer_id ?? null;
  const isDirect = linkedDealerId === null ? 1 : 0;
  let deliveryDealerId = linkedDealerId;
  let assignmentStatus = linkedDealerId ? 'assigned' : 'unassigned';
  if (!deliveryDealerId) {
    const admin = db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1`).get();
    if (admin) { deliveryDealerId = admin.id; assignmentStatus = 'admin'; }
  }

  const qty = enrollment.reward_quantity || 1;

  /* After the first month the winner already has the container this oil comes
   * in, so every delivery after it is a REFILL: the trader brings oil and
   * fills what they have, rather than handing over another steel can. Without
   * this a winner accumulates one container a month for the rest of the round.
   *
   * Decided from what they actually hold, not from the month number, so it
   * stays right if they return a container mid-round or the first delivery is
   * still in transit. */
  const holdsOne = product.container_type
    ? db.prepare(`
        SELECT COUNT(*) AS n FROM container_holdings
         WHERE consumer_id = ? AND current_product_id = ?
           AND status IN ('held', 'pending_delivery')
      `).get(consumerId, product.id).n > 0
    : false;
  const isRefill = holdsOne ? 1 : 0;

  const orderNumber = `BCFREE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const result = db.transaction(() => {
    // Re-check inside the transaction. The check above ran against a snapshot
    // taken before any of the address and product lookups, so two taps in
    // quick succession, or the same winner on two devices, could both pass it
    // and both place a free order. This is the one that actually counts.
    if (rewardOrderThisMonth(consumerId, cycleWindow(now))) {
      throw httpError(409, "This month's free delivery is already on its way");
    }

    const or = db.prepare(`
      INSERT INTO consumer_orders
        (order_number, consumer_id, linked_dealer_id, delivery_dealer_id, is_direct, status, payment_status,
         subtotal, total_amount, pincode, delivery_address, notes, confirmation_sent,
         delivery_latitude, delivery_longitude, delivery_h3_index, assignment_status, created_at)
      VALUES (?,?,?,?,?, 'pending', 'paid', 0, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      orderNumber, consumerId, linkedDealerId, deliveryDealerId, isDirect,
      addr.pincode, addr.address,
      `${LUCKY_DRAW_NAME} reward, month ${cycle.month_number} of ${SCHEME_MONTHS}`,
      addr.latitude || null, addr.longitude || null, addr.h3_index || null, assignmentStatus,
      // Stamped from the same clock the month was decided by, not from
      // CURRENT_TIMESTAMP. Those are the same instant in production, but a
      // half-injected clock is a trap: the order would land in one month while
      // the "already claimed this month" check looked at another.
      sqliteTime(now.toISOString()),
    );
    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, container_cost, is_refill)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).run(or.lastInsertRowid, product.id, qty, isRefill);
    db.prepare(`UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?`).run(qty, product.id);
    return { orderId: or.lastInsertRowid, orderNumber };
  })();

  if (deliveryDealerId) {
    try {
      createNotification(
        'dealer', deliveryDealerId,
        `${LUCKY_DRAW_NAME} ${isRefill ? 'refill' : 'reward'} to pack — ${consumer.name}`,
        isRefill
          ? `${consumer.name} won ${enrollment.scheme_name} and claimed this month's ${product.name} (x${qty}). REFILL: they already have the container, so top it up. No charge.`
          : `${consumer.name} won ${enrollment.scheme_name} and claimed this month's ${product.name} (x${qty}). First one, so it goes out in a new container. No charge.`,
        { order_id: result.orderId, order_number: result.orderNumber, scheme_id: enrollment.scheme_id },
      );
    } catch { /* non-fatal */ }
  }

  /* Every free order gets its own ₹0 receipt, whatever it is. Goods are
   * leaving the business and arriving at a named address; that is a supply,
   * and it needs a document whether or not any money moved.
   *
   * This used to be gated on the product having a container, because the
   * container holding is materialised off the invoice. That gate meant a free
   * 200ml or 1L was delivered with no receipt at all. The container is one
   * reason to raise the invoice, not the reason.
   *
   * Async and swallowed, exactly as the payment path treats it: a bookkeeping
   * failure must not undo a delivery that is already promised. */
  generateInvoiceForOrder(result.orderId)
    .catch(err => console.error(`[lucky-draw] invoice for ${result.orderNumber} failed:`, err.message));

  return { success: true, order_number: result.orderNumber, product_name: product.name, quantity: qty };
}

/* ── Loyalty weighting (spec §3.17, formula settled) ──────────────────────
 *
 * Tickets = 1 + floor(qualifying months so far / 3), capped at 4. So 0-2
 * months carries 1 ticket, 3-5 carries 2, 6-8 three, 9+ four.
 *
 * CUMULATIVE months, not a consecutive streak. A streak that resets on one
 * missed month manufactures the "I broke it, why bother" moment, and
 * simulation showed its extra weighting comes almost entirely out of the
 * middle of the base (people who order most months) rather than out of the
 * occasional buyers. Cumulative is monotonic: every order always helps and
 * nothing is ever lost, which also matches §3.9.
 *
 * Worth knowing: entering at all requires a purchase that month, so uniform
 * odds are ALREADY loyalty-weighted at roughly 2.9x across a round. This
 * takes it to about 4.6x. It is an amplifier, not the mechanism.
 */
const TICKETS_PER_MONTHS = 3;
const MAX_TICKETS = 4;

function ticketsFor(enrollmentId) {
  const qualified = db.prepare(`
    SELECT COUNT(*) AS n FROM lucky_draw_monthly_entries
     WHERE enrollment_id = ? AND qualified = 1
  `).get(enrollmentId).n;
  return Math.min(1 + Math.floor(qualified / TICKETS_PER_MONTHS), MAX_TICKETS);
}

/**
 * Give the reward container back and step out of the round.
 *
 * A winner is not obliged to keep taking deliveries for eleven more months.
 * Leaving hands back the container that came with the reward and closes the
 * enrollment, which is one action from the consumer's side and has to be one
 * action here: returning the can while staying enrolled would leave the next
 * month's delivery with nothing to arrive in.
 *
 * 'withdrawn' rather than 'completed': completing a round means reaching the
 * end of it. Every query that looks for members filters on 'active'/'won', so
 * a withdrawn enrollment drops out of the draws, the cards and the counts
 * without any of them needing to know this status exists.
 */
function leaveScheme(consumerId, { destination = 'store_credit' } = {}) {
  const enrollment = db.prepare(`
    SELECT e.*, s.name AS scheme_name FROM lucky_draw_enrollments e
    JOIN lucky_draw_schemes s ON s.id = e.scheme_id
    WHERE e.consumer_id = ? AND e.status IN ('active','won')
    ORDER BY e.created_at DESC LIMIT 1
  `).get(consumerId);
  if (!enrollment) throw httpError(400, 'You are not in a round to leave.');

  const holdings = require('../containerHoldingsService');
  const mine = db.prepare(`
    SELECT id, status FROM container_holdings
     WHERE consumer_id = ? AND source = 'lucky_draw_reward' AND status IN ('held','pending_delivery')
  `).all(consumerId);

  const returned = [];
  for (const h of mine) {
    try {
      holdings.requestRefund({ holdingId: h.id, consumerId, destination });
      returned.push(h.id);
    } catch (err) {
      // A container that cannot be handed back (already in a return, say)
      // must not block someone from leaving.
      console.error(`[lucky-draw] could not start the return of holding ${h.id}:`, err.message);
    }
  }

  db.prepare(`UPDATE lucky_draw_enrollments SET status='withdrawn' WHERE id=?`).run(enrollment.id);

  try {
    createNotification(
      'consumer', consumerId,
      `You have left ${enrollment.scheme_name}`,
      returned.length
        ? 'Your delivery agent will collect the container on the next round. No more free deliveries will be sent.'
        : 'No more free deliveries will be sent.',
      { scheme_id: enrollment.scheme_id },
    );
  } catch { /* non-fatal */ }

  return { success: true, scheme_name: enrollment.scheme_name, containers_returned: returned.length };
}

/**
 * Run a scheme's draw for the current month: record who qualified, pick one
 * winner among them (spec §3.11), snapshot their qualifying purchase as the
 * reward (§3.7), and take them out of the pool (§3.13).
 */
function runDrawForScheme(schemeId, now = new Date()) {
  const scheme = db.prepare(`SELECT * FROM lucky_draw_schemes WHERE id = ?`).get(schemeId);
  if (!scheme) throw httpError(404, 'Scheme not found');

  // Everything from the "has this month already been drawn" check through to
  // the winner being written happens in ONE transaction. Read the guard
  // outside it and two admins pressing "Run this month now" at the same
  // moment each pass it, each pick a different winner, and the scheme ends
  // the month with two, which §3.11 says cannot happen. better-sqlite3
  // serialises transactions, so the second caller now sees the first one's
  // result and is refused.
  const decision = db.transaction(() => decideDraw(scheme, now))();

  for (const e of decision.pool) {
    const won = decision.winnerEnrollmentId !== null && e.id === decision.winnerEnrollmentId;
    try {
      createNotification(
        'consumer', e.consumer_id,
        won ? `You won ${scheme.name}!` : `${scheme.name}: month ${decision.month_number} draw is done`,
        won
          ? 'Your reward item will be delivered free every month for the rest of the round.'
          : decision.winner_display_name
            ? `${decision.winner_display_name} won this month. Order by the 10th to enter the next draw.`
            : 'No one qualified this month, so the draw went to nobody. Order by the 10th to be in the next one.',
        { scheme_id: schemeId, month_number: decision.month_number },
      );
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    month_number: decision.month_number,
    entrants: decision.entrants,
    has_winner: decision.winnerEnrollmentId !== null,
    winner_consumer_id: decision.winner_consumer_id,
    winner_display_name: decision.winner_display_name,
  };
}

/** The draw itself. Only ever called inside a transaction (see above). */
function decideDraw(scheme, now) {
  const schemeId = scheme.id;
  const window = cycleWindow(now);
  if (latestDraw(schemeId)?.month_key === window.month_key) {
    throw httpError(409, "This month's draw has already been run for this scheme");
  }

  const pool = db.prepare(`
    SELECT e.*, c.name AS consumer_name FROM lucky_draw_enrollments e
    JOIN consumers c ON c.id = e.consumer_id
    WHERE e.scheme_id = ? AND e.status = 'active'
  `).all(schemeId);
  // One entrant is a valid draw: they win. The only number that cannot be
  // drawn from is zero, so the guards below check for empty, never for "too
  // few", and both say which of the two empties it is.
  if (pool.length === 0) {
    throw httpError(400, 'No one is still qualifying in this scheme. Everyone enrolled has either won already or the scheme has no members.');
  }

  const monthNumber = monthNumberFor(scheme, pool[0], now);

  // The pool is whoever has a qualified entry row for this month. Those rows
  // were written as their orders were paid, so the draw reads a ledger it
  // didn't build, and a purchase made at 11:58PM on the 10th is already in it.
  const qualified = pool
    .map(e => ({ enrollment: e, entry: entryFor(e.id, monthNumber) }))
    .filter(x => x.entry && x.entry.qualified && !x.entry.draw_run_at);
  const ranAt = now.toISOString().slice(0, 19).replace('T', ' ');

  /* Nobody qualified. The draw still HAPPENED — the 12th came, the wheel was
   * turned, and the honest result is that it stopped on no one. Recording it
   * rather than refusing is what lets everyone enrolled see the outcome
   * instead of a month that silently never resolved, and it closes the month
   * so a late order cannot slip into a draw that is already over. */
  if (qualified.length === 0) {
    /* Only once the window has actually shut. Recording a no-winner draw
     * stamps the month closed, so running one early — the admin's "Run this
     * month now", or a dev tool — would lock everybody out of a month they
     * still had days to enter. Before the deadline this is not a draw with no
     * winner, it is a draw that is too early to hold. */
    if (now <= new Date(window.entry_deadline)) {
      const who = pool.length === 1
        ? "The one person enrolled hasn't"
        : `None of the ${pool.length} people enrolled have`;
      throw httpError(400,
        `${who} placed a qualifying order yet, and the window is open until the 10th. `
        + 'There is no one to draw from until then.');
    }

    for (const e of pool) {
      db.prepare(`
        INSERT INTO lucky_draw_monthly_entries
          (enrollment_id, month_number, qualified, is_winner, draw_run_at)
        VALUES (?,?,0,0,?)
        ON CONFLICT(enrollment_id, month_number) DO UPDATE SET
          is_winner=0, draw_run_at=excluded.draw_run_at
      `).run(e.id, monthNumber, ranAt);
    }
    return {
      pool,
      winnerEnrollmentId: null,
      month_number: monthNumber,
      entrants: 0,
      winner_consumer_id: null,
      winner_display_name: null,
    };
  }

  /* Classic raffle: every entrant's tickets go in, one is drawn. Walking a
   * cumulative weight rather than building an array keeps it O(n) however
   * many tickets anyone has accumulated. */
  for (const q of qualified) q.tickets = ticketsFor(q.enrollment.id);
  const totalTickets = qualified.reduce((sum, q) => sum + q.tickets, 0);
  let ticket = Math.random() * totalTickets;
  let pick = qualified[qualified.length - 1];
  for (const q of qualified) {
    ticket -= q.tickets;
    if (ticket <= 0) { pick = q; break; }
  }
  const winningOrderId = db.prepare(`
    SELECT qualifying_order_id FROM lucky_draw_monthly_entries
     WHERE enrollment_id = ? AND month_number = ?
  `).get(pick.enrollment.id, monthNumber).qualifying_order_id;
  // Spec §3.7: the reward is their most recent qualifying purchase, which is
  // the order the entry row has been tracking all month.
  const item = db.prepare(`
    SELECT product_id, quantity FROM consumer_order_items WHERE order_id = ? ORDER BY total DESC LIMIT 1
  `).get(winningOrderId);

  for (const e of pool) {
    const entered = qualified.find(q => q.enrollment.id === e.id);
    const isWinner = entered && entered.enrollment.id === pick.enrollment.id ? 1 : 0;
    // Everyone still qualifying gets a row stamped with the draw, winner or
    // not: a missed month is a fact about the round worth keeping (§3.9),
    // and the stamp is what closes the month against later entries.
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries
        (enrollment_id, month_number, qualified, is_winner, draw_run_at, tickets)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(enrollment_id, month_number) DO UPDATE SET
        is_winner=excluded.is_winner,
        draw_run_at=excluded.draw_run_at,
        tickets=excluded.tickets
    `).run(e.id, monthNumber, entered ? 1 : 0, isWinner, ranAt, entered ? entered.tickets : 0);
  }
  db.prepare(`
    UPDATE lucky_draw_enrollments
       SET status='won', won_at_month=?, reward_product_id=?, reward_quantity=?
     WHERE id=?
  `).run(monthNumber, item?.product_id || null, item?.quantity || 1, pick.enrollment.id);

  // Notifications are the caller's job: they send mail and must not be able
  // to roll back, or fail, a draw that has already been decided.
  return {
    pool,
    winnerEnrollmentId: pick.enrollment.id,
    month_number: monthNumber,
    entrants: qualified.length,
    winner_consumer_id: pick.enrollment.consumer_id,
    winner_display_name: privacyName(pick.enrollment.consumer_name),
  };
}

module.exports = {
  ticketsFor,
  leaveScheme,
  getConsumerCycle,
  placeRewardOrder,
  runDrawForScheme,
  recordQualifyingOrder,
  backfillCurrentMonthEntries,
  cycleWindow,
  SCHEME_MONTHS,
};
