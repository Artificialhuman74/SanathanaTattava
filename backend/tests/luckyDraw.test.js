/**
 * Bhagya Chakra — regression cover for the bugs found in the audit.
 *
 * Each block names the wrong behaviour it locks out, because every one of
 * these passed a reading of the code and only showed up against the calendar.
 */
const db = require('../src/database/db');
const factory = require('./helpers/factory');

const schemeService = require('../src/services/luckyDraw/schemeService');
const enrollmentService = require('../src/services/luckyDraw/enrollmentService');
const drawService = require('../src/services/luckyDraw/drawService');

/** ISO string N months from now (negative = in the past). */
const monthsFromNow = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString();
};

function makeScheme({ status = 'running', startsAt, endsAt, closesAt, firstDrawAt, name = 'Test Round' } = {}) {
  const r = db.prepare(`
    INSERT INTO lucky_draw_schemes
      (name, status, joining_fee, enrollment_opens_at, enrollment_closes_at, starts_at, first_draw_at, ends_at)
    VALUES (?, ?, 100, ?, ?, ?, ?, ?)
  `).run(name, status, startsAt, closesAt ?? startsAt, startsAt, firstDrawAt ?? null, endsAt);
  return db.prepare('SELECT * FROM lucky_draw_schemes WHERE id = ?').get(r.lastInsertRowid);
}

function makeEnrollment(schemeId, consumerId, status = 'active', extra = {}) {
  const r = db.prepare(`
    INSERT INTO lucky_draw_enrollments
      (scheme_id, consumer_id, status, joining_fee_paid, enrolled_at, won_at_month, reward_product_id, reward_quantity)
    VALUES (?, ?, ?, 100, CURRENT_TIMESTAMP, ?, ?, ?)
  `).run(schemeId, consumerId, status, extra.won_at_month ?? null, extra.reward_product_id ?? null, extra.reward_quantity ?? null);
  return db.prepare('SELECT * FROM lucky_draw_enrollments WHERE id = ?').get(r.lastInsertRowid);
}

let dealer;
beforeEach(() => {
  /* Before factory.clearAll(), not after: it does not know about these tables
   * (the feature is meant to lift out cleanly, spec §10), and enrollments hold
   * a foreign key onto consumers. */
  db.prepare('DELETE FROM lucky_draw_monthly_entries').run();
  db.prepare('DELETE FROM lucky_draw_enrollments').run();
  db.prepare('DELETE FROM lucky_draw_schemes').run();
  factory.clearAll();
  dealer = factory.createTrader().user;
});

describe('a finished round releases the consumer', () => {
  // WAS: nothing ever moved an enrollment off 'won', and 'won' occupies the
  // single scheme slot — so winning a round banned you from every future one.
  test('a winner is closed out when the round reaches its end date', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const scheme = makeScheme({ startsAt: monthsFromNow(-13), endsAt: monthsFromNow(-1) });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'won', { won_at_month: 4 });

    expect(enrollmentService.getActiveEnrollment(consumer.id)).toBeTruthy();

    schemeService.advanceSchemeStatuses();

    expect(db.prepare('SELECT status FROM lucky_draw_enrollments WHERE id=?').get(enrollment.id).status)
      .toBe('completed');
    expect(db.prepare('SELECT status FROM lucky_draw_schemes WHERE id=?').get(scheme.id).status)
      .toBe('ended');
    // The slot is free: they can be enrolled in the next round.
    expect(enrollmentService.getActiveEnrollment(consumer.id)).toBeUndefined();
  });

  // WAS: setSchemeStatus('end') wrote the status and nothing else — no
  // guarantee, and every enrollment stranded on 'active' for ever.
  test('ending a scheme by hand closes out its enrollments too', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const winner = factory.createConsumer({ linked_dealer_id: dealer.id }).consumer;
    const scheme = makeScheme({ startsAt: monthsFromNow(-3), endsAt: monthsFromNow(9) });
    const a = makeEnrollment(scheme.id, consumer.id, 'active');
    const w = makeEnrollment(scheme.id, winner.id, 'won', { won_at_month: 2 });

    schemeService.setSchemeStatus(scheme.id, 'end');

    expect(db.prepare('SELECT status FROM lucky_draw_enrollments WHERE id=?').get(a.id).status).toBe('completed');
    expect(db.prepare('SELECT status FROM lucky_draw_enrollments WHERE id=?').get(w.id).status).toBe('completed');
    expect(enrollmentService.getActiveEnrollment(consumer.id)).toBeUndefined();
    expect(enrollmentService.getActiveEnrollment(winner.id)).toBeUndefined();
  });

  // WAS: the auto-end sweep matched status='running' only, so a scheme left
  // paused sailed past its end date and never closed anybody out.
  test('a paused scheme still ends when its twelve months are up', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const scheme = makeScheme({ status: 'paused', startsAt: monthsFromNow(-13), endsAt: monthsFromNow(-1) });
    makeEnrollment(scheme.id, consumer.id, 'won', { won_at_month: 1 });

    schemeService.advanceSchemeStatuses();

    expect(db.prepare('SELECT status FROM lucky_draw_schemes WHERE id=?').get(scheme.id).status).toBe('ended');
    expect(enrollmentService.getActiveEnrollment(consumer.id)).toBeUndefined();
  });
});

describe('the round holds exactly twelve draws', () => {
  // WAS: monthNumberFor clamps to 12, and a round anchored to the enrollment
  // close date meets the fixed draw day a 13th time before ends_at. That draw
  // clamped onto month 12, cleared the month_key guard, and crowned a SECOND
  // month-12 winner — then again every month after.
  test('a draw past the twelfth is refused, not clamped back onto month 12', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    // Started 14 months ago: every one of its twelve draws is behind us.
    const scheme = makeScheme({ startsAt: monthsFromNow(-14), endsAt: monthsFromNow(-2) });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries (enrollment_id, month_number, qualified, is_winner)
      VALUES (?, 12, 1, 0)
    `).run(enrollment.id);

    expect(() => drawService.runDrawForScheme(scheme.id))
      .toThrow(/all 12 of its draws/);

    expect(db.prepare('SELECT status FROM lucky_draw_enrollments WHERE id=?').get(enrollment.id).status)
      .toBe('active');
  });

  test('a month that has already been drawn cannot be drawn again', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const first = '2026-07-12T11:30:00.000Z';
    const scheme = makeScheme({
      startsAt: '2026-07-01T00:00:00.000Z',
      firstDrawAt: first,
      endsAt: '2027-07-12T11:30:00.000Z',
    });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');

    // The draw due on 12 August is month 2, and it has already been held.
    const august = new Date('2026-08-20T06:00:00Z');
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries (enrollment_id, month_number, qualified, is_winner, draw_run_at)
      VALUES (?, 2, 1, 0, '2026-08-12 11:30:00')
    `).run(enrollment.id);

    // Refused either by the "ran this calendar month" guard or by the
    // month_number one behind it — both protect the same invariant (§3.11).
    expect(() => drawService.runDrawForScheme(scheme.id, august))
      .toThrow(/already been (drawn|run)/);
  });

  test('running early, before the month’s draw is due, says so', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const scheme = makeScheme({
      startsAt: '2026-07-01T00:00:00.000Z',
      firstDrawAt: '2026-07-12T11:30:00.000Z',
      endsAt: '2027-07-12T11:30:00.000Z',
    });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries (enrollment_id, month_number, qualified, is_winner, draw_run_at)
      VALUES (?, 2, 1, 0, '2026-08-12 11:30:00')
    `).run(enrollment.id);

    // 5 September: August's draw is settled, September's is a week away.
    expect(() => drawService.runDrawForScheme(scheme.id, new Date('2026-09-05T06:00:00Z')))
      .toThrow(/Entries are still open/);
  });
});

describe('a reversed purchase loses the entry it bought', () => {
  // WAS: recordQualifyingOrder wrote an entry on payment and nothing ever
  // unwrote it — so buy, get entered, refund, and the entry (and the tickets,
  // and the reward snapshot) all stood.
  test('cancelling the qualifying order clears the entry', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const product = factory.createProduct();
    const scheme = makeScheme({ startsAt: monthsFromNow(-1), endsAt: monthsFromNow(11) });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');

    const order = factory.createConsumerOrder(consumer.id, { total_amount: 500, payment_status: 'paid' });
    db.prepare('INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?,?,1,500,500)')
      .run(order.id, product.id);

    expect(drawService.recordQualifyingOrder(order.id)).toBeTruthy();
    const entry = () => db.prepare(
      'SELECT * FROM lucky_draw_monthly_entries WHERE enrollment_id = ?').get(enrollment.id);
    expect(entry().qualified).toBe(1);

    db.prepare(`UPDATE consumer_orders SET status='cancelled' WHERE id=?`).run(order.id);
    drawService.revokeQualifyingOrder(order.id);

    expect(entry().qualified).toBe(0);
    expect(entry().qualifying_order_id).toBeNull();
  });

  test('an earlier order in the same window keeps them in the draw', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const product = factory.createProduct();
    const scheme = makeScheme({ startsAt: monthsFromNow(-1), endsAt: monthsFromNow(11) });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');

    const mk = () => {
      const o = factory.createConsumerOrder(consumer.id, { total_amount: 500, payment_status: 'paid' });
      db.prepare('INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?,?,1,500,500)')
        .run(o.id, product.id);
      return o;
    };
    const first = mk();
    const second = mk();
    drawService.recordQualifyingOrder(first.id);
    drawService.recordQualifyingOrder(second.id);

    db.prepare(`UPDATE consumer_orders SET status='cancelled' WHERE id=?`).run(second.id);
    drawService.revokeQualifyingOrder(second.id);

    const entry = db.prepare('SELECT * FROM lucky_draw_monthly_entries WHERE enrollment_id = ?').get(enrollment.id);
    expect(entry.qualified).toBe(1);
    expect(entry.qualifying_order_id).toBe(first.id);
  });

  test('a month whose draw has already run is left alone', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const product = factory.createProduct();
    const scheme = makeScheme({ startsAt: monthsFromNow(-1), endsAt: monthsFromNow(11) });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');
    const order = factory.createConsumerOrder(consumer.id, { total_amount: 500, payment_status: 'paid' });
    db.prepare('INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?,?,1,500,500)')
      .run(order.id, product.id);
    drawService.recordQualifyingOrder(order.id);
    db.prepare(`UPDATE lucky_draw_monthly_entries SET draw_run_at='2026-01-01 00:00:00' WHERE enrollment_id=?`)
      .run(enrollment.id);

    db.prepare(`UPDATE consumer_orders SET status='cancelled' WHERE id=?`).run(order.id);
    expect(drawService.revokeQualifyingOrder(order.id)).toBeNull();

    const entry = db.prepare('SELECT * FROM lucky_draw_monthly_entries WHERE enrollment_id = ?').get(enrollment.id);
    expect(entry.qualified).toBe(1);
  });
});

describe('an abandoned checkout is not an enrollment', () => {
  // WAS: a 'pending_payment' row never expired and occupied the single slot
  // for ever, so someone who opened the payment sheet once and closed it could
  // never join anything again — and the page told them nothing was running.
  test('a pending_payment on a closed round stops holding the slot', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const dead = makeScheme({ status: 'ended', startsAt: monthsFromNow(-14), endsAt: monthsFromNow(-2), name: 'Old Round' });
    makeEnrollment(dead.id, consumer.id, 'pending_payment');

    expect(enrollmentService.getActiveEnrollment(consumer.id)).toBeUndefined();
  });

  test('a pending_payment on a still-open round does hold the slot', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const open = makeScheme({ status: 'enrollment_open', startsAt: monthsFromNow(1), endsAt: monthsFromNow(13), closesAt: monthsFromNow(1) });
    makeEnrollment(open.id, consumer.id, 'pending_payment');

    expect(enrollmentService.getActiveEnrollment(consumer.id)?.status).toBe('pending_payment');
  });
});

describe('recent winners are ordered by when they won', () => {
  // WAS: ORDER BY e.id DESC — i.e. by who signed up last, not who won last.
  test('the most recent draw leads the list', () => {
    const scheme = makeScheme({ startsAt: monthsFromNow(-3), endsAt: monthsFromNow(9) });
    const early = factory.createConsumer({ name: 'Asha Rao', linked_dealer_id: dealer.id }).consumer;
    const late = factory.createConsumer({ name: 'Bala Nair', linked_dealer_id: dealer.id }).consumer;

    // `early` enrolled first but won LAST.
    const e1 = makeEnrollment(scheme.id, early.id, 'won', { won_at_month: 3 });
    const e2 = makeEnrollment(scheme.id, late.id, 'won', { won_at_month: 2 });
    const stamp = (id, month, at) => db.prepare(`
      INSERT INTO lucky_draw_monthly_entries (enrollment_id, month_number, qualified, is_winner, draw_run_at)
      VALUES (?,?,1,1,?)`).run(id, month, at);
    stamp(e2.id, 2, '2026-02-12 11:30:00');
    stamp(e1.id, 3, '2026-03-12 11:30:00');

    const winners = enrollmentService.listRecentWinners();
    expect(winners.map(w => w.display_name)).toEqual(['Asha R.', 'Bala N.']);
  });
});

/* ── The round is twelve draws ───────────────────────────────────────────── */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The Nth draw of a round (1-based), as a real instant. */
function drawNumber(firstDrawIso, n) {
  const f = new Date(new Date(firstDrawIso).getTime() + IST_OFFSET_MS);
  const total = f.getUTCFullYear() * 12 + f.getUTCMonth() + (n - 1);
  return new Date(Date.UTC(Math.floor(total / 12), total % 12, 12, 11, 30));
}

/** A paid order for `consumer`, backdated to `at`, recorded as a draw entry. */
function buyAt(consumerId, productId, at) {
  const o = factory.createConsumerOrder(consumerId, { total_amount: 500, payment_status: 'paid' });
  db.prepare('INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total) VALUES (?,?,1,500,500)')
    .run(o.id, productId);
  db.prepare('UPDATE consumer_orders SET created_at=? WHERE id=?')
    .run(at.toISOString().slice(0, 19).replace('T', ' '), o.id);
  drawService.recordQualifyingOrder(o.id);
  return o;
}

describe('a round is twelve consecutive monthly draws', () => {
  // WAS: the round was counted as twelve calendar months from `starts_at` —
  // the day enrollment closed, which is any day of any month. With the draw on
  // a FIXED day, a round starting on the 20th held its first draw in "month 2",
  // month 1 never had a draw at all, and the draw day came round a 13th time
  // before the end date. Eleven real draws and one duplicate.
  const STARTS_AT = '2026-09-20T12:00:00.000Z';   // deliberately mid-month

  test('the first draw after the round starts is month 1', () => {
    const first = drawService.firstDrawAt(STARTS_AT);
    // 20 Sep starts the round; the 12 Sep draw has gone, so the first is 12 Oct.
    expect(first.toISOString()).toBe('2026-10-12T11:30:00.000Z');

    const scheme = makeScheme({
      startsAt: STARTS_AT,
      endsAt: drawService.roundEndsAt(STARTS_AT).toISOString(),
      firstDrawAt: first.toISOString(),
    });
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');
    const product = factory.createProduct();

    // Bought the day after joining, well before the first draw.
    buyAt(consumer.id, product.id, new Date('2026-09-21T06:00:00Z'));

    const entry = db.prepare('SELECT * FROM lucky_draw_monthly_entries WHERE enrollment_id=?').get(enrollment.id);
    expect(entry.month_number).toBe(1);
  });

  test('the round ends one month after its twelfth draw — the 13th month', () => {
    const first = drawService.firstDrawAt(STARTS_AT);
    expect(drawService.roundEndsAt(STARTS_AT).toISOString())
      .toBe(drawNumber(first.toISOString(), 13).toISOString());
  });

  test('twelve draws run, numbered 1 to 12, and the thirteenth is refused', () => {
    const first = drawService.firstDrawAt(STARTS_AT);
    const scheme = makeScheme({
      startsAt: STARTS_AT,
      endsAt: drawService.roundEndsAt(STARTS_AT).toISOString(),
      firstDrawAt: first.toISOString(),
    });
    const product = factory.createProduct({ stock: 10000 });

    // Thirteen members, so a winner peeling off each month never empties the pool.
    const members = Array.from({ length: 13 }, () => {
      const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
      makeEnrollment(scheme.id, consumer.id, 'active');
      return consumer;
    });

    const monthsDrawn = [];
    for (let n = 1; n <= 12; n++) {
      const drawAt = drawNumber(first.toISOString(), n);
      const buyOn = new Date(drawAt.getTime() - 2 * 24 * 3600e3);
      for (const m of members) {
        const still = db.prepare(
          `SELECT status FROM lucky_draw_enrollments WHERE consumer_id=? AND scheme_id=?`).get(m.id, scheme.id);
        if (still.status === 'active') buyAt(m.id, product.id, buyOn);
      }
      const result = drawService.runDrawForScheme(scheme.id, drawAt);
      monthsDrawn.push(result.month_number);
      expect(result.has_winner).toBe(true);
    }

    expect(monthsDrawn).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // One winner per scheme per month, across the whole round (spec §3.11).
    const winnersPerMonth = db.prepare(`
      SELECT me.month_number, COUNT(*) AS n FROM lucky_draw_monthly_entries me
        JOIN lucky_draw_enrollments e ON e.id = me.enrollment_id
       WHERE e.scheme_id = ? AND me.is_winner = 1 GROUP BY me.month_number
    `).all(scheme.id);
    expect(winnersPerMonth).toHaveLength(12);
    expect(winnersPerMonth.every(r => r.n === 1)).toBe(true);

    // The draw day comes round a 13th time. It must not be held.
    expect(() => drawService.runDrawForScheme(scheme.id, drawNumber(first.toISOString(), 13)))
      .toThrow(/all 12 of its draws/);
  });

  test('a draw held late is still the draw that was due, not next month’s', () => {
    const first = drawService.firstDrawAt(STARTS_AT);
    const scheme = makeScheme({
      startsAt: STARTS_AT,
      endsAt: drawService.roundEndsAt(STARTS_AT).toISOString(),
      firstDrawAt: first.toISOString(),
    });
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    makeEnrollment(scheme.id, consumer.id, 'active');
    const product = factory.createProduct();
    buyAt(consumer.id, product.id, new Date('2026-10-10T06:00:00Z'));

    // The server was down on the 12th and only comes back on the 15th.
    const late = new Date(drawNumber(first.toISOString(), 1).getTime() + 3 * 24 * 3600e3);
    const result = drawService.runDrawForScheme(scheme.id, late);

    expect(result.month_number).toBe(1);
  });

  test('a purchase made after this month’s draw enters the next one', () => {
    const first = drawService.firstDrawAt(STARTS_AT);
    const scheme = makeScheme({
      startsAt: STARTS_AT,
      endsAt: drawService.roundEndsAt(STARTS_AT).toISOString(),
      firstDrawAt: first.toISOString(),
    });
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');
    const product = factory.createProduct();

    // Two days after the month-1 draw.
    buyAt(consumer.id, product.id, new Date(drawNumber(first.toISOString(), 1).getTime() + 2 * 24 * 3600e3));

    const entry = db.prepare('SELECT * FROM lucky_draw_monthly_entries WHERE enrollment_id=?').get(enrollment.id);
    expect(entry.month_number).toBe(2);
  });

  test('the due draw is the one that has passed, so a late tick still catches it', () => {
    const drawDay = new Date('2026-10-12T11:30:00.000Z');
    // Before the draw moment: the one still due is September's.
    expect(drawService.dueDrawAt(new Date('2026-10-12T11:00:00Z')).toISOString())
      .toBe('2026-09-12T11:30:00.000Z');
    // At it, and days after it: still October's, so a missed day is caught up.
    expect(drawService.dueDrawAt(drawDay).toISOString()).toBe('2026-10-12T11:30:00.000Z');
    expect(drawService.dueDrawAt(new Date('2026-10-20T09:00:00Z')).toISOString())
      .toBe('2026-10-12T11:30:00.000Z');
  });
});

/* ── One round at a time, and a round that can actually be joined ─────────── */

describe('an enrolled consumer is shown no other round', () => {
  function openRound(name) {
    return makeScheme({
      status: 'enrollment_open',
      name,
      startsAt: monthsFromNow(1),
      closesAt: monthsFromNow(1),
      endsAt: monthsFromNow(13),
    });
  }

  // Decision #4/#5: one scheme at a time, and "in a scheme" includes the
  // post-win tail. Someone already in a round must not be offered another.
  test.each(['active', 'won'])('a consumer whose enrollment is %s sees nothing open', (status) => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const mine = makeScheme({ startsAt: monthsFromNow(-2), endsAt: monthsFromNow(10), name: 'My Round' });
    makeEnrollment(mine.id, consumer.id, status, status === 'won' ? { won_at_month: 2 } : {});
    openRound('Another Round');

    const active = enrollmentService.getActiveEnrollment(consumer.id);
    const holdsASlot = !!active && active.status !== 'pending_payment';
    expect(holdsASlot).toBe(true);
    expect(holdsASlot ? [] : schemeService.listOpenSchemes()).toEqual([]);
  });

  test('a consumer in no round sees the open one', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    openRound('Another Round');

    const active = enrollmentService.getActiveEnrollment(consumer.id);
    const holdsASlot = !!active && active.status !== 'pending_payment';
    expect(holdsASlot ? [] : schemeService.listOpenSchemes().map(s => s.name)).toEqual(['Another Round']);
  });

  test('a consumer whose round has finished sees the next one', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const done = makeScheme({ status: 'ended', startsAt: monthsFromNow(-14), endsAt: monthsFromNow(-2), name: 'Old Round' });
    makeEnrollment(done.id, consumer.id, 'completed');
    openRound('Next Round');

    const active = enrollmentService.getActiveEnrollment(consumer.id);
    const holdsASlot = !!active && active.status !== 'pending_payment';
    expect(holdsASlot ? [] : schemeService.listOpenSchemes().map(s => s.name)).toEqual(['Next Round']);
  });
});

describe('a round whose enrollment window has lapsed', () => {
  // WAS: the admin card read a green "Enrolling" off the raw status while
  // listOpenSchemes checked the date and returned nothing, so the admin saw a
  // live round and consumers saw "isn't running right now". Nothing reconciled
  // them, and no action could reopen it.
  test('is reported as not joinable, not as "enrolling"', () => {
    makeScheme({
      status: 'enrollment_open',
      name: 'Lapsed',
      startsAt: monthsFromNow(-1),
      closesAt: monthsFromNow(-1),
      endsAt: monthsFromNow(11),
    });
    const [row] = schemeService.listSchemes();
    expect(row.status).toBe('enrollment_open');
    expect(row.enrollment_open_now).toBe(0);
    expect(schemeService.listOpenSchemes()).toEqual([]);
  });

  test('can be reopened on a new date, and consumers see it again', () => {
    const scheme = makeScheme({
      status: 'enrollment_open',
      name: 'Lapsed',
      startsAt: monthsFromNow(-1),
      closesAt: monthsFromNow(-1),
      endsAt: monthsFromNow(11),
    });
    const newClose = monthsFromNow(1);

    schemeService.reopenEnrollment(scheme.id, newClose);

    expect(schemeService.listOpenSchemes().map(s => s.name)).toEqual(['Lapsed']);
    const after = schemeService.getScheme(scheme.id);
    // The whole schedule moves with the closing date.
    expect(after.first_draw_at).toBe(drawService.firstDrawAt(newClose).toISOString());
    expect(after.ends_at).toBe(drawService.roundEndsAt(newClose).toISOString());
  });

  test('cannot be reopened once a draw has been held (spec §3.3)', () => {
    const { consumer } = factory.createConsumer({ linked_dealer_id: dealer.id });
    const scheme = makeScheme({ startsAt: monthsFromNow(-2), endsAt: monthsFromNow(10) });
    const enrollment = makeEnrollment(scheme.id, consumer.id, 'active');
    db.prepare(`
      INSERT INTO lucky_draw_monthly_entries (enrollment_id, month_number, qualified, is_winner, draw_run_at)
      VALUES (?, 1, 1, 1, '2026-08-12 11:30:00')
    `).run(enrollment.id);

    expect(() => schemeService.reopenEnrollment(scheme.id, monthsFromNow(1)))
      .toThrow(/already held/);
  });

  test('a past date is refused', () => {
    const scheme = makeScheme({
      status: 'enrollment_open', name: 'Lapsed',
      startsAt: monthsFromNow(-1), closesAt: monthsFromNow(-1), endsAt: monthsFromNow(11),
    });
    expect(() => schemeService.reopenEnrollment(scheme.id, monthsFromNow(-1)))
      .toThrow(/date in the future/);
  });
});
