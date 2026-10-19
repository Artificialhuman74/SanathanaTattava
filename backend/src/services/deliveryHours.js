/**
 * Traders' delivery hours (handoff §4.10). Times are minutes from local midnight
 * (Asia/Kolkata), weekday 0 = Monday. Shared by the app, admin and dispatch.
 */
const db = require('../database/db');

const MIN = 360;   // 6 AM, the earliest the editor allows
const MAX = 1320;  // 10 PM, the latest
const DEFAULTS = [
  ...Array.from({ length: 5 }, () => ({ enabled: true, start: 480, end: 1200 })), // Mon–Fri 8 AM–8 PM
  { enabled: true, start: 540, end: 1080 },                                      // Sat 9 AM–6 PM
  { enabled: false, start: 540, end: 780 },                                      // Sun closed
];

function getHours(userId) {
  const rows = db.prepare('SELECT * FROM delivery_hours WHERE user_id = ? ORDER BY weekday').all(userId);
  const days = DEFAULTS.map((d, weekday) => {
    const r = rows.find((x) => x.weekday === weekday);
    return r ? { weekday, enabled: !!r.enabled, start: r.start_min, end: r.end_min } : { weekday, ...d };
  });
  const last = rows.reduce((a, r) => (!a || r.updated_at > a.updated_at ? r : a), null);
  return { days, saved: rows.length > 0, updated_by: last?.updated_by || null, updated_at: last?.updated_at || null };
}

/** Validates 7 days and stores them. Returns an error string, or null. */
function setHours(userId, days, updatedBy) {
  if (!Array.isArray(days) || days.length !== 7) return 'Send all 7 days';
  for (const d of days) {
    const start = Number(d?.start);
    const end = Number(d?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return 'Times must be whole minutes';
    if (start < MIN || end > MAX) return 'Hours must be between 6 AM and 10 PM';
    if (end - start < 60) return 'Keep at least one hour open';
    if (start % 30 || end % 30) return 'Use half-hour steps';
  }
  const put = db.prepare(`
    INSERT INTO delivery_hours (user_id, weekday, enabled, start_min, end_min, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, weekday) DO UPDATE SET
      enabled = excluded.enabled, start_min = excluded.start_min, end_min = excluded.end_min,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `);
  db.transaction(() => {
    days.forEach((d, weekday) => put.run(userId, weekday, d.enabled ? 1 : 0, d.start, d.end, updatedBy));
  })();
  return null;
}

/** Local (IST) weekday 0 = Monday and minutes since midnight for a Date. */
function localClock(date = new Date()) {
  const ist = new Date(date.getTime() + 330 * 60000);
  return { weekday: (ist.getUTCDay() + 6) % 7, minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(), ist };
}

/** Is the trader open at this moment? */
function isOpen(userId, date = new Date()) {
  const { weekday, minutes } = localClock(date);
  const d = getHours(userId).days[weekday];
  return d.enabled && minutes >= d.start && minutes < d.end;
}

/** The next moment their hours open (a Date), or null if every day is closed. Now if open. */
function nextOpening(userId, date = new Date()) {
  const { days } = getHours(userId);
  const { weekday, minutes, ist } = localClock(date);
  for (let ahead = 0; ahead < 8; ahead++) {
    const d = days[(weekday + ahead) % 7];
    if (!d.enabled) continue;
    if (ahead === 0 && minutes >= d.end) continue;
    if (ahead === 0 && minutes >= d.start) return date;
    const dayStartIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + ahead);
    return new Date(dayStartIst + d.start * 60000 - 330 * 60000);
  }
  return null;
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 480 → "8 AM", 1230 → "8:30 PM". */
function clockText(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * A week as one short line for lists: "Mon–Sat 8 AM–8 PM", "Every day 9 AM–6 PM",
 * "Mon–Fri 8 AM–8 PM · Sat 9 AM–6 PM". Runs of days with the same hours are joined.
 */
function summarize(days) {
  const open = days.filter((d) => d.enabled);
  if (!open.length) return 'Closed every day';
  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && d.enabled && last.start === d.start && last.end === d.end && last.to === d.weekday - 1) last.to = d.weekday;
    else if (d.enabled) runs.push({ from: d.weekday, to: d.weekday, start: d.start, end: d.end });
  }
  if (runs.length === 1 && open.length === 7) return `Every day ${clockText(runs[0].start)}–${clockText(runs[0].end)}`;
  return runs.map((r) => {
    const span = r.from === r.to ? DAY[r.from] : `${DAY[r.from]}${r.to - r.from === 1 ? ', ' : '–'}${DAY[r.to]}`;
    return `${span} ${clockText(r.start)}–${clockText(r.end)}`;
  }).join(' · ');
}

module.exports = { getHours, setHours, isOpen, nextOpening, localClock, summarize, clockText, DEFAULTS, MIN, MAX };
