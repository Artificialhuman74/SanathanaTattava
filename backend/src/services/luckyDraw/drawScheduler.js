/**
 * Automated monthly draw scheduler.
 *
 * Checks once a minute whether the configured draw moment has been reached
 * (day-of-month + time, both in IST, because the business runs on Indian time
 * regardless of where the server lives). Fires at most once per IST day, and
 * CATCHES UP: if the server was down, or the feature was switched on after the
 * scheduled time, the run happens at the next tick rather than being skipped
 * for a whole month.
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
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

/** Date-like whose getUTC* methods report IST wall-clock values. */
function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function istDateString(d) {
  return d.toISOString().slice(0, 10);
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
      skipped.push({ scheme_id: scheme.id, scheme_name: scheme.name, reason: err.message });
    }
  }
  return { ran, skipped };
}

function tick() {
  try {
    // Runs whether or not draws are enabled: a scheme's own dates shouldn't
    // stall because automatic draws happen to be paused.
    schemeService.advanceSchemeStatuses();

    const { enabled, day, time, last_run } = getSchedule();
    if (!enabled) return;

    const ist = nowIST();
    if (ist.getUTCDate() !== day) return;

    const hhmm = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
    if (hhmm < time) return;                       // not yet reached today

    if (last_run) {
      const lastIST = new Date(new Date(last_run).getTime() + IST_OFFSET_MS);
      if (istDateString(lastIST) === istDateString(ist)) return;   // already ran today
    }

    // Catches anyone whose entry write was missed while the server was down,
    // right before the pool is read. Cheap, and the alternative is quietly
    // leaving them out of a draw they paid to be in.
    drawService.backfillCurrentMonthEntries();

    const { ran, skipped } = runDueDraws();
    setSetting('lucky_draw_last_run', new Date().toISOString());

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
