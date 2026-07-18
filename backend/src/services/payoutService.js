/**
 * Weekly payout processing — shared by the admin "Process Week" button
 * and the automated scheduler (payoutScheduler.js).
 *
 * Groups all pending commissions by trader + week, creates a
 * weekly_payouts row per group, and marks those commissions paid.
 * Exactly the behaviour the manual admin action has always had.
 */
const db = require('../database/db');

function getSetting(key, fallback = null) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value));
}

/**
 * Process all pending commissions into weekly payouts.
 * @param {'manual'|'auto'} trigger — who kicked it off (for logs/notifications)
 * @returns {{ payoutsCreated: number, totalAmount: number }}
 */
function processWeeklyPayouts(trigger = 'manual') {
  const pending = db.prepare(`
    SELECT trader_id, week_start, week_end, COUNT(*) as count, SUM(amount) as total
    FROM commissions WHERE status = 'pending'
    GROUP BY trader_id, week_start, week_end
  `).all();

  const result = db.transaction(() => {
    let count = 0, totalAmount = 0;
    for (const row of pending) {
      db.prepare(`
        INSERT INTO weekly_payouts (trader_id,amount,week_start,week_end,commission_count,status,processed_at)
        VALUES (?,?,?,?,?,'pending',CURRENT_TIMESTAMP)
      `).run(row.trader_id, row.total, row.week_start, row.week_end, row.count);
      db.prepare(`
        UPDATE commissions SET status='paid', paid_at=CURRENT_TIMESTAMP
        WHERE trader_id=? AND week_start=? AND week_end=? AND status='pending'
      `).run(row.trader_id, row.week_start, row.week_end);
      count++;
      totalAmount += row.total;
    }
    return { payoutsCreated: count, totalAmount: +totalAmount.toFixed(2) };
  })();

  if (result.payoutsCreated > 0) {
    console.log(
      `[payouts] ${trigger} run: created ${result.payoutsCreated} payout(s) totalling ₹${result.totalAmount}`
    );
    /* Tell every admin what the automation did — silence breeds distrust
     * in money automation. Manual runs skip this (the admin is looking
     * at the result already). Lazy-required to avoid an import cycle
     * (notificationService → socketServer at module load). */
    if (trigger === 'auto') {
      try {
        const { createNotification } = require('./notificationService');
        const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
        for (const a of admins) {
          createNotification(
            'admin', a.id,
            'Weekly payouts processed automatically',
            `${result.payoutsCreated} payout(s) totalling ₹${result.totalAmount.toFixed(2)} were created from pending commissions. Review them on the Payouts page.`,
            { payouts_created: result.payoutsCreated, total_amount: result.totalAmount }
          );
        }
      } catch (err) {
        console.error('[payouts] auto-run notification failed:', err.message);
      }
    }
  }

  return result;
}

module.exports = { processWeeklyPayouts, getSetting, setSetting };
