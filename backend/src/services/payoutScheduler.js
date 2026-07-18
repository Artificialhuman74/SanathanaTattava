/**
 * Automated weekly payout scheduler.
 *
 * Checks once a minute whether the configured payout moment has been
 * reached (day-of-week + time, both in IST — the business runs on
 * Indian time regardless of where the server lives). Fires at most
 * once per IST day, and CATCHES UP: if the server was down (or the
 * feature was enabled) after the scheduled time on the scheduled day,
 * the run happens at the next tick rather than being skipped a week.
 *
 * Settings keys (settings table):
 *   auto_payout_enabled   '1' | '0'         (default: '1')
 *   auto_payout_day       '0'..'6', 0=Sun   (default: '5' = Friday)
 *   auto_payout_time      'HH:MM' 24h IST   (default: '18:00')
 *   auto_payout_last_run  ISO timestamp of the last automatic run
 */
const { processWeeklyPayouts, getSetting, setSetting } = require('./payoutService');
const db = require('../database/db');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;

/** Date-like whose getUTC* methods report IST wall-clock values. */
function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function istDateString(d) {
  return d.toISOString().slice(0, 10);   // YYYY-MM-DD of the IST wall clock
}

function seedDefaults() {
  const seed = db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`);
  seed.run('auto_payout_enabled', '1');
  seed.run('auto_payout_day', '5');       // Friday
  seed.run('auto_payout_time', '18:00');  // 6 PM IST
}

function tick() {
  try {
    if (getSetting('auto_payout_enabled', '0') !== '1') return;

    const day  = parseInt(getSetting('auto_payout_day', '5'), 10);
    const time = getSetting('auto_payout_time', '18:00');

    const ist = nowIST();
    if (ist.getUTCDay() !== day) return;

    const hhmm = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
    if (hhmm < time) return;                       // not yet reached today

    const lastRun = getSetting('auto_payout_last_run', null);
    if (lastRun) {
      const lastIST = new Date(new Date(lastRun).getTime() + IST_OFFSET_MS);
      if (istDateString(lastIST) === istDateString(ist)) return;   // already ran today
    }

    const result = processWeeklyPayouts('auto');
    setSetting('auto_payout_last_run', new Date().toISOString());
    console.log(
      `[payout-scheduler] auto run complete: ${result.payoutsCreated} payout(s), ₹${result.totalAmount}`
    );
  } catch (err) {
    console.error('[payout-scheduler] tick error:', err.message);
  }
}

function startPayoutScheduler() {
  try { seedDefaults(); }
  catch (err) { console.error('[payout-scheduler] seed defaults failed:', err.message); }
  setInterval(tick, TICK_MS);
  console.log('[payout-scheduler] started (checking every minute, IST schedule)');
}

module.exports = { startPayoutScheduler };
