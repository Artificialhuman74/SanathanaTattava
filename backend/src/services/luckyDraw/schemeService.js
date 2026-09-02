/**
 * Lucky draw — scheme management (admin side).
 *
 * Kept isolated from the rest of the order/checkout code on purpose: this
 * is a temporary/promotional feature (see LUCKY_DRAW_FEATURE_SPEC.md §10)
 * and everything it needs to exist lives under services/luckyDraw/ and
 * routes/luckyDraw.js so it can be deleted cleanly later.
 *
 * Scope note: this pass covers scheme creation + listing only (the
 * "introduction" entry point for admin). The draw-execution job, pause/
 * cancel controls, and cross-trader visualization are a follow-up pass —
 * see LUCKY_DRAW_FEATURE_SPEC.md §9.
 */
const db = require('../../database/db');

const SCHEME_MONTHS = 12;

/* A round is twelve DRAWS, one a month on the draw day — not twelve calendar
 * months from an arbitrary start date. drawService owns that arithmetic; this
 * file just records the two dates it produces. Required lazily: drawService
 * pulls in notificationService, and requiring it at module load closes a cycle
 * through db.js during boot. */
const drawDates = () => require('./drawService');

/**
 * Every scheme with the live numbers §9.2 asks for: how many are enrolled,
 * how many have already qualified for the month in progress, and how many
 * have won so far. `qualified_this_month` reads the entry rows written when
 * orders are paid, so it is the same count the draw itself will use.
 */
function listSchemes() {
  return db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM lucky_draw_enrollments e
             WHERE e.scheme_id = s.id AND e.status IN ('active','won')) AS enrolled_count,
           (SELECT COUNT(*) FROM lucky_draw_enrollments e
             WHERE e.scheme_id = s.id AND e.status = 'won') AS won_count,
           (SELECT COUNT(*) FROM lucky_draw_monthly_entries me
              JOIN lucky_draw_enrollments e2 ON e2.id = me.enrollment_id
             WHERE e2.scheme_id = s.id AND me.qualified = 1 AND me.draw_run_at IS NULL) AS qualified_this_month,
           /* Whether a consumer can join RIGHT NOW — the same test
            * listOpenSchemes applies, reported next to the status rather than
            * left to be inferred from it.
            *
            * The status alone is not the answer, and treating it as one cost a
            * live round: a scheme whose window had lapsed still read
            * enrollment_open, the admin page showed a green "Enrolling" chip
            * and a closing date in the past, and consumers were shown "isn't
            * running right now" — because listOpenSchemes checks the date and
            * the chip did not. Two screens, two answers, no way to tell which
            * was lying. */
           (CASE WHEN s.status = 'enrollment_open'
                  AND (s.enrollment_closes_at IS NULL
                       OR datetime(s.enrollment_closes_at) > datetime('now'))
                 THEN 1 ELSE 0 END) AS enrollment_open_now,
           (SELECT COUNT(*) FROM lucky_draw_monthly_entries me
              JOIN lucky_draw_enrollments e3 ON e3.id = me.enrollment_id
             WHERE e3.scheme_id = s.id AND me.draw_run_at IS NOT NULL) AS draws_held
      FROM lucky_draw_schemes s
     ORDER BY s.created_at DESC
  `).all();
}

/**
 * Put a round back into enrollment, on a new closing date.
 *
 * The recovery path for the one way a round can quietly become unreachable:
 * its enrollment window lapses. Nothing warned anybody, no consumer could join,
 * and there was no action that could undo it — the admin's only option was to
 * abandon the scheme and build another.
 *
 * Not a contradiction of §3.3, which settles that LATECOMERS cannot join a
 * round already under way. That is enforced here by refusing once any draw has
 * been held: before the first draw nobody has been in a draw, so there is no
 * latecomer to admit and nothing anyone could be late to.
 *
 * The round hangs off the enrollment close date, so moving it moves the whole
 * schedule with it.
 */
function reopenEnrollment(schemeId, enrollmentClosesAt) {
  const scheme = getScheme(schemeId);
  if (!scheme) throw Object.assign(new Error('Scheme not found'), { status: 404 });
  if (scheme.status === 'ended') {
    throw Object.assign(new Error(`${scheme.name} has ended. Create a new round instead.`), { status: 400 });
  }

  const held = db.prepare(`
    SELECT COUNT(*) AS n FROM lucky_draw_monthly_entries me
      JOIN lucky_draw_enrollments e ON e.id = me.enrollment_id
     WHERE e.scheme_id = ? AND me.draw_run_at IS NOT NULL
  `).get(schemeId).n;
  if (held > 0) {
    throw Object.assign(
      new Error(`${scheme.name} has already held ${held === 1 ? 'a draw' : 'draws'}, so enrollment can't be reopened (spec §3.3).`),
      { status: 400 },
    );
  }

  const closesAt = new Date(enrollmentClosesAt);
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) {
    throw Object.assign(new Error('The new closing date must be a valid date in the future'), { status: 400 });
  }

  const { firstDrawAt, roundEndsAt } = drawDates();
  db.prepare(`
    UPDATE lucky_draw_schemes
       SET status = 'enrollment_open', enrollment_closes_at = ?, starts_at = ?,
           first_draw_at = ?, ends_at = ?
     WHERE id = ?
  `).run(
    closesAt.toISOString(), closesAt.toISOString(),
    firstDrawAt(closesAt.toISOString()).toISOString(),
    roundEndsAt(closesAt.toISOString()).toISOString(),
    schemeId,
  );
  return getScheme(schemeId);
}

/**
 * Admin's manual control over a scheme (spec §9.2).
 *
 * The automatic transitions in advanceSchemeStatuses() handle the ordinary
 * case; this is the override for when the ordinary case isn't what you want:
 * starting a round early, freezing one mid-flight, or ending it. Paused is not
 * in the §4 lifecycle diagram because §4 describes what happens on its own;
 * a paused scheme is one that has been deliberately taken out of that flow.
 *
 * Transitions are whitelisted rather than free-form. "Reopen enrollment" is
 * deliberately absent: §3.3 settles that latecomers cannot join once the
 * window has closed, so putting a running scheme back to enrollment_open
 * would contradict a decision the spec marks as not up for re-litigation.
 */
const TRANSITIONS = {
  start:  { from: ['enrollment_open'],            to: 'running', verb: 'started' },
  pause:  { from: ['running'],                    to: 'paused',  verb: 'paused'  },
  resume: { from: ['paused'],                     to: 'running', verb: 'resumed' },
  end:    { from: ['enrollment_open', 'running', 'paused'], to: 'ended', verb: 'ended' },
};

function setSchemeStatus(schemeId, action) {
  const rule = TRANSITIONS[action];
  if (!rule) throw Object.assign(new Error(`Unknown action "${action}"`), { status: 400 });

  const scheme = getScheme(schemeId);
  if (!scheme) throw Object.assign(new Error('Scheme not found'), { status: 404 });
  if (!rule.from.includes(scheme.status)) {
    throw Object.assign(
      new Error(`${scheme.name} is "${scheme.status}", so it can't be ${rule.verb}. That needs it to be ${rule.from.map(f => `"${f}"`).join(' or ')}.`),
      { status: 400 },
    );
  }

  // Starting early moves the goalposts with it: the round is a fixed twelve
  // months (Decision #8), so twelve months from when it actually starts, not
  // from the date enrollment was originally going to close.
  if (action === 'start') {
    const startsAt = new Date();
    const { firstDrawAt, roundEndsAt } = drawDates();
    db.prepare(`
      UPDATE lucky_draw_schemes
         SET status = ?, enrollment_closes_at = ?, starts_at = ?, first_draw_at = ?, ends_at = ?
       WHERE id = ?
    `).run(
      rule.to, startsAt.toISOString(), startsAt.toISOString(),
      firstDrawAt(startsAt.toISOString()).toISOString(),
      roundEndsAt(startsAt.toISOString()).toISOString(),
      schemeId,
    );
  } else {
    /* Ending by hand has to do everything ending by date does. It used to
     * write the status and stop, which left every enrollment on the scheme
     * sitting at 'active'/'won' for ever: no 13th-month guarantee, and — worse
     * — a slot that never frees, so those consumers could never join another
     * round again. The button now owes them exactly what the calendar would. */
    if (rule.to === 'ended') closeOutScheme(schemeId);
    db.prepare(`UPDATE lucky_draw_schemes SET status = ? WHERE id = ?`).run(rule.to, schemeId);
  }

  return getScheme(schemeId);
}

/**
 * Settle every enrollment on a round that is finishing, whichever way it got
 * there (its own end date, or the admin's "end" button).
 *
 * Two populations, and the second one was being missed entirely:
 *   - 'active'  — never won, so they are owed the 13th-month guarantee (§3.14).
 *   - 'won'     — had their reward all round, and now need CLOSING. Nothing
 *                 ever moved a winner off 'won', and 'won' is one of the
 *                 statuses that occupies a consumer's single scheme slot
 *                 (Decision #4/#5), so winning a round quietly banned you from
 *                 every future one. §3.5 says the block lasts until the scheme
 *                 ends. This is where it ends.
 *
 * Idempotent: both steps only match rows that are still open.
 */
function closeOutScheme(schemeId) {
  let guarantee = null;
  try {
    guarantee = require('./guaranteeService').runGuaranteeForScheme(schemeId);
  } catch (err) {
    console.error(`[lucky-draw] 13th-month guarantee failed for scheme ${schemeId}:`, err.message);
  }

  const closedWinners = db.prepare(`
    UPDATE lucky_draw_enrollments SET status = 'completed'
     WHERE scheme_id = ? AND status = 'won'
  `).run(schemeId).changes;

  /* An enrollment that never got paid for is not an enrollment. Left on
   * 'pending_payment' it goes on holding the consumer's slot against a round
   * that no longer exists. */
  const closedUnpaid = db.prepare(`
    UPDATE lucky_draw_enrollments SET status = 'abandoned'
     WHERE scheme_id = ? AND status = 'pending_payment'
  `).run(schemeId).changes;

  return { guarantee, closedWinners, closedUnpaid };
}

function getScheme(schemeId) {
  return db.prepare(`SELECT * FROM lucky_draw_schemes WHERE id = ?`).get(schemeId);
}

/**
 * Schemes a consumer could join right now: enrollment open and window not yet
 * closed.
 *
 * Every date comparison in this file goes through `datetime()` on BOTH sides.
 * The columns hold ISO-8601 ("2026-09-01T06:34:53.847Z") while
 * CURRENT_TIMESTAMP produces "2026-09-01 06:34:53", and SQLite compares them
 * as text: 'T' sorts above ' ', so on the day a window closes the raw
 * comparison stays false for the whole day. Schemes silently refused to start
 * on their own closing date, and closed ones stayed joinable until midnight.
 */
function listOpenSchemes() {
  return db.prepare(`
    SELECT * FROM lucky_draw_schemes
     WHERE status = 'enrollment_open'
       AND (enrollment_closes_at IS NULL OR datetime(enrollment_closes_at) > datetime('now'))
     ORDER BY created_at DESC
  `).all();
}

function createScheme({ name, joiningFee, enrollmentClosesAt, createdBy }) {
  const fee = joiningFee != null ? Number(joiningFee) : 100;
  if (!name || !name.trim()) throw Object.assign(new Error('Scheme name is required'), { status: 400 });
  if (!Number.isFinite(fee) || fee < 0) throw Object.assign(new Error('Joining fee must be a non-negative number'), { status: 400 });
  if (!enrollmentClosesAt) throw Object.assign(new Error('Enrollment closing date is required'), { status: 400 });

  const closesAt = new Date(enrollmentClosesAt);
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) {
    throw Object.assign(new Error('Enrollment closing date must be a valid date in the future'), { status: 400 });
  }

  /* The round is twelve consecutive monthly draws (Decision #8), starting with
   * the first draw day that falls after enrollment closes, and it is over where
   * the thirteenth would have been — which is when the 13th-month guarantee
   * goes out (§3.14). A system invariant, not admin-configurable.
   *
   * Counting twelve calendar months from `closesAt` instead put the round out
   * of step with its own draws: it began mid-month, so its first draw landed in
   * "month 2" and it ran into a thirteenth draw day before finishing. */
  const startsAt = closesAt;
  const { firstDrawAt, roundEndsAt } = drawDates();
  const firstDraw = firstDrawAt(startsAt.toISOString());
  const endsAt = roundEndsAt(startsAt.toISOString());

  const result = db.prepare(`
    INSERT INTO lucky_draw_schemes
      (name, status, joining_fee, enrollment_opens_at, enrollment_closes_at, starts_at, first_draw_at, ends_at, created_by)
    VALUES (?, 'enrollment_open', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
  `).run(name.trim(), fee, closesAt.toISOString(), startsAt.toISOString(),
    firstDraw.toISOString(), endsAt.toISOString(), createdBy);

  return getScheme(result.lastInsertRowid);
}

/**
 * Move schemes through the lifecycle in §4 as their dates pass.
 *
 * The transitions are time-driven rather than buttons, because both dates are
 * already fixed when the scheme is created: enrollment closes on the date the
 * admin picked, and the round is a fixed 12 months from there (Decision #8).
 * Without this, a scheme created as 'enrollment_open' stayed that way for
 * ever, and nothing downstream that looks for a 'running' scheme, the monthly
 * draw included, would ever find one.
 *
 * Idempotent and cheap; safe to call on every scheduler tick.
 */
function advanceSchemeStatuses() {
  const opened = db.prepare(`
    UPDATE lucky_draw_schemes
       SET status = 'running'
     WHERE status = 'enrollment_open'
       AND enrollment_closes_at IS NOT NULL
       AND datetime(enrollment_closes_at) <= datetime('now')
  `).run().changes;

  /* A round that has reached its end owes everyone still trying their
   * 13th-month delivery (§3.14), and owes its winners their slot back. That
   * has to happen BEFORE the scheme is marked ended, because both are owed to
   * enrollments in 'active'/'won', and closing the scheme first is how they
   * would quietly be missed.
   *
   * 'paused' is swept too. Pausing freezes the draws, not the calendar: the
   * round is a fixed twelve months (Decision #8), and a scheme left paused
   * over its end date used to match neither this sweep nor the one below, so
   * its members were stranded on 'active' with no guarantee and no way out. */
  const finishing = db.prepare(`
    SELECT id FROM lucky_draw_schemes
     WHERE status IN ('running','paused') AND ends_at IS NOT NULL AND datetime(ends_at) <= datetime('now')
  `).all();

  const guaranteed = [];
  for (const s of finishing) {
    const { guarantee } = closeOutScheme(s.id);
    if (guarantee) guaranteed.push(guarantee);
  }

  const ended = db.prepare(`
    UPDATE lucky_draw_schemes
       SET status = 'ended'
     WHERE status IN ('running','paused')
       AND ends_at IS NOT NULL
       AND datetime(ends_at) <= datetime('now')
  `).run().changes;

  return { opened, ended, guaranteed };
}

module.exports = { listSchemes, getScheme, listOpenSchemes, createScheme, advanceSchemeStatuses, setSchemeStatus, closeOutScheme, reopenEnrollment, SCHEME_MONTHS };
