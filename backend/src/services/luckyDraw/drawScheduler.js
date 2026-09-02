/**
 * Automated monthly draw scheduler.
 *
 * Checks once a minute whether the month's draw moment has passed without that
 * draw being held (day-of-month + time, both in IST, because the business runs
 * on Indian time regardless of where the server lives). CATCHES UP properly: if
 * the server was down for an hour, a day, or a week, the draw happens on the
 * next tick rather than being lost. A round is twelve consecutive draws, so a
 * month that quietly never resolves is not an option.
 *
 * Deliberately the same shape as payoutScheduler.js. A second scheduler with
 * its own conventions would be a second thing to reason about at 5PM on the
 * 12th; this one behaves exactly like the one already in production.
 *
 * Settings keys (settings table), all editable from the admin Bhagya Chakra page:
 *   lucky_draw_auto_enabled  '1' | '0'        (default: '1')
 *   lucky_draw_day           '1'..'28'        (default: '12', spec §3.10)
 *   lucky_draw_time          'HH:MM' 24h IST  (default: '17:00')
 *   lucky_draw_last_run      ISO timestamp of the last automatic run
 */
const db = require('../../database/db');
const drawService = require('./drawService');
const schemeService = require('./schemeService');

const TICK_MS = 60 * 1000;

/* Above the 28th a monthly schedule silently skips February, so the input is
 * capped rather than letting an admin pick a day that doesn't always exist. */
const MAX_DRAW_DAY = 28;

const DEFAULTS = {
  lucky_draw_auto_enabled: '1',
  lucky_draw_day: '12',
  lucky_draw_time: '17:00',
};

function getSetting(key, fallback = null) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}

/** The current config, clamped to values the scheduler can actually honour. */
function getSchedule() {
  const day = parseInt(getSetting('lucky_draw_day', DEFAULTS.lucky_draw_day), 10);
  return {
    enabled: getSetting('lucky_draw_auto_enabled', DEFAULTS.lucky_draw_auto_enabled) === '1',
    day: Math.min(Math.max(Number.isFinite(day) ? day : 12, 1), MAX_DRAW_DAY),
    time: getSetting('lucky_draw_time', DEFAULTS.lucky_draw_time),
    last_run: getSetting('lucky_draw_last_run', null),
  };
}

function saveSchedule({ enabled, day, time }) {
  if (enabled !== undefined) setSetting('lucky_draw_auto_enabled', enabled ? '1' : '0');
  if (day !== undefined) {
    const d = parseInt(day, 10);
    if (!Number.isFinite(d) || d < 1 || d > MAX_DRAW_DAY) {
      throw Object.assign(new Error(`Draw day must be between 1 and ${MAX_DRAW_DAY}`), { status: 400 });
    }
    setSetting('lucky_draw_day', String(d));
  }
  if (time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) {
      throw Object.assign(new Error('Draw time must be in 24-hour HH:MM format'), { status: 400 });
    }
    setSetting('lucky_draw_time', String(time));
  }
  return getSchedule();
}

/**
 * Run every running scheme's draw for this month. A scheme that has already
 * drawn, or that nobody qualified in, is skipped rather than failing the
 * batch: one empty scheme must not stop the others from drawing.
 */
function runDueDraws(now = new Date()) {
  // A scheme whose enrollment window closed since the last tick is running
  // now, even though nothing has told it so yet.
  schemeService.advanceSchemeStatuses();
  const schemes = db.prepare(`SELECT id, name FROM lucky_draw_schemes WHERE status = 'running'`).all();
  const ran = [];
  const skipped = [];
  for (const scheme of schemes) {
    try {
      const result = drawService.runDrawForScheme(scheme.id, now);
      ran.push({ scheme_id: scheme.id, scheme_name: scheme.name, ...result });
    } catch (err) {
      /* Carry the status through. A refusal (already drawn, nobody in the
       * pool) is a settled answer for today; anything without a status is an
       * error, and the difference decides whether today is marked done. */
      skipped.push({ scheme_id: scheme.id, scheme_name: scheme.name, reason: err.message, status: err.status || null });
    }
  }
  return { ran, skipped };
}

function tick() {
  try {
    // Runs whether or not draws are enabled: a scheme's own dates shouldn't
    // stall because automatic draws happen to be paused.
    schemeService.advanceSchemeStatuses();

    const { enabled, last_run } = getSchedule();
    if (!enabled) return;

    /* Has the draw come due, and have we held it?
     *
     * This used to gate on `ist.getUTCDate() !== day` — the draw could only
     * ever fire ON the 12th. The header promised it would catch up "if the
     * server was down", and it did, but only within that one calendar day:
     * lose the whole of the 12th and that month's draw was skipped for good,
     * silently, with nothing to say so. That is not a hypothetical on a backend
     * that runs on a laptop behind a tunnel, and a round is supposed to be
     * twelve CONSECUTIVE draws.
     *
     * Comparing against the due draw instant instead catches up across days
     * and months, and still cannot double-run: once a draw has been held,
     * last_run is at or after it until the next one comes due. */
    const due = drawService.dueDrawAt();
    if (last_run && new Date(last_run) >= due) return;

    // Catches anyone whose entry write was missed while the server was down,
    // right before the pool is read. Cheap, and the alternative is quietly
    // leaving them out of a draw they paid to be in.
    drawService.backfillCurrentMonthEntries();

    const { ran, skipped } = runDueDraws();

    /* Only mark the day done when the outcome was an actual answer.
     *
     * This used to be stamped unconditionally, so one unexpected error at
     * 5PM on the 12th (a locked database, a bad row, anything without an
     * HTTP status on it) marked the day as run and the next tick returned
     * early. The month's draw would then never happen at all, and nothing
     * would say so. A refusal is fine to stamp: it will refuse again. */
    const transient = skipped.filter(s => s.status === null);
    if (transient.length === 0) {
      setSetting('lucky_draw_last_run', new Date().toISOString());
    } else {
      console.error('[draw-scheduler] not marking today done, will retry:',
        transient.map(t => `${t.scheme_name}: ${t.reason}`).join('; '));
    }

    for (const r of ran) {
      console.log(`[draw-scheduler] ${r.scheme_name}: month ${r.month_number}, ${r.entrants} entrant(s), winner ${r.winner_display_name}`);
    }
    for (const s of skipped) {
      console.log(`[draw-scheduler] ${s.scheme_name}: skipped (${s.reason})`);
    }
    if (!ran.length && !skipped.length) console.log('[draw-scheduler] no running schemes');
  } catch (err) {
    console.error('[draw-scheduler] tick error:', err.message);
  }
}

function startDrawScheduler() {
  try {
    const seed = db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`);
    for (const [key, value] of Object.entries(DEFAULTS)) seed.run(key, value);
    /* Baseline the catch-up so it only ever looks forward. Without this, the
     * first tick on a fresh install would see "a draw came due and last_run is
     * empty" and immediately hold whatever draw the current month had already
     * passed — closing a month nobody knew was being drawn. */
    seed.run('lucky_draw_last_run', new Date().toISOString());
  } catch (err) {
    console.error('[draw-scheduler] seed defaults failed:', err.message);
  }

  try {
    const { opened, ended, guaranteed } = schemeService.advanceSchemeStatuses();
    if (opened) console.log(`[draw-scheduler] ${opened} scheme(s) moved to running`);
    if (ended) console.log(`[draw-scheduler] ${ended} scheme(s) ended`);
    for (const g of guaranteed || []) {
      if (g.delivered.length || g.skipped.length) {
        console.log(`[draw-scheduler] ${g.scheme_name}: 13th-month guarantee sent ${g.delivered.length}, skipped ${g.skipped.length}`);
      }
    }
  } catch (err) {
    console.error('[draw-scheduler] scheme advance failed:', err.message);
  }

  // Repairs anything the payment-time write missed while this process was
  // down. Idempotent, current month only, never touches a drawn month.
  try {
    const added = drawService.backfillCurrentMonthEntries();
    if (added) console.log(`[draw-scheduler] backfilled ${added} draw entr${added === 1 ? 'y' : 'ies'} for this month`);
  } catch (err) {
    console.error('[draw-scheduler] backfill failed:', err.message);
  }

  setInterval(tick, TICK_MS);
  const { day, time, enabled } = getSchedule();
  console.log(`[draw-scheduler] started (${enabled ? `day ${day} at ${time} IST` : 'disabled'}, checking every minute)`);
}

module.exports = { startDrawScheduler, getSchedule, saveSchedule, runDueDraws, MAX_DRAW_DAY };
