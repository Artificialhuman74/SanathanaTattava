/**
 * Abandoned-order sweeper
 *
 * Auto-cancels orders that were created but never paid, then restores any
 * inventory that may have been deducted. Safe to call repeatedly — the
 * inventory restore is idempotent.
 */
const db = require('../database/db');
const { returnOrderInventory } = require('./inventoryService');

const DEFAULT_STALE_MINUTES = 30;

function sweepAbandonedOrders({ staleMinutes = DEFAULT_STALE_MINUTES } = {}) {
  const stale = db.prepare(`
    SELECT id FROM consumer_orders
    WHERE status = 'pending'
      AND payment_status IN ('pending','failed')
      AND created_at <= datetime('now', ?)
  `).all(`-${staleMinutes} minutes`);

  let cancelled = 0, restored = 0;
  for (const { id } of stale) {
    db.prepare(`UPDATE consumer_orders SET status='cancelled' WHERE id=?`).run(id);
    cancelled++;
    try {
      const r = returnOrderInventory(id);
      if (r && r.restored) restored++;
    } catch (e) {
      console.error('[sweeper] restore failed for', id, e.message);
    }
  }
  if (cancelled) console.log(`[sweeper] cancelled ${cancelled} abandoned orders (restored ${restored})`);
  return { cancelled, restored, ids: stale.map(s => s.id) };
}

module.exports = { sweepAbandonedOrders, DEFAULT_STALE_MINUTES };
