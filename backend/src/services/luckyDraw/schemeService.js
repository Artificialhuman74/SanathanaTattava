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
             WHERE e2.scheme_id = s.id AND me.qualified = 1 AND me.draw_run_at IS NULL) AS qualified_this_month
      FROM lucky_draw_schemes s
     ORDER BY s.created_at DESC
  `).all();
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
    const endsAt = new Date(startsAt);
    endsAt.setMonth(endsAt.getMonth() + SCHEME_MONTHS);
    db.prepare(`
      UPDATE lucky_draw_schemes
         SET status = ?, enrollment_closes_at = ?, starts_at = ?, ends_at = ?
       WHERE id = ?
    `).run(rule.to, startsAt.toISOString(), startsAt.toISOString(), endsAt.toISOString(), schemeId);
  } else {
    db.prepare(`UPDATE lucky_draw_schemes SET status = ? WHERE id = ?`).run(rule.to, schemeId);
  }

  return getScheme(schemeId);
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

  // Scheme runs for a fixed 12 months starting the day enrollment closes —
  // this is a system invariant (spec Decision #8), not admin-configurable.
  const startsAt = closesAt;
  const endsAt = new Date(startsAt);
  endsAt.setMonth(endsAt.getMonth() + SCHEME_MONTHS);

  const result = db.prepare(`
    INSERT INTO lucky_draw_schemes
      (name, status, joining_fee, enrollment_opens_at, enrollment_closes_at, starts_at, ends_at, created_by)
    VALUES (?, 'enrollment_open', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
  `).run(name.trim(), fee, closesAt.toISOString(), startsAt.toISOString(), endsAt.toISOString(), createdBy);

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
   * 13th-month delivery (§3.14). That has to happen BEFORE the scheme is
   * marked ended, because the guarantee is owed to enrollments in 'active',
   * and closing the scheme first is how they would quietly be missed. */
  const finishing = db.prepare(`
    SELECT id FROM lucky_draw_schemes
     WHERE status = 'running' AND ends_at IS NOT NULL AND datetime(ends_at) <= datetime('now')
  `).all();

  const guaranteed = [];
  for (const s of finishing) {
    try {
      guaranteed.push(require('./guaranteeService').runGuaranteeForScheme(s.id));
    } catch (err) {
      console.error(`[lucky-draw] 13th-month guarantee failed for scheme ${s.id}:`, err.message);
    }
  }

  const ended = db.prepare(`
    UPDATE lucky_draw_schemes
       SET status = 'ended'
     WHERE status = 'running'
       AND ends_at IS NOT NULL
       AND datetime(ends_at) <= datetime('now')
  `).run().changes;

  return { opened, ended, guaranteed };
}

module.exports = { listSchemes, getScheme, listOpenSchemes, createScheme, advanceSchemeStatuses, setSchemeStatus, SCHEME_MONTHS };
