/**
 * Abandoned-order sweeper
 *
 * Deletes orders that were created but never paid, restoring any inventory
 * that was deducted at checkout. Abandoned orders never really happened —
 * removing them keeps the admin view free of "cancelled" rows that were
 * only ever placeholders for an incomplete payment.
 *
 * Returns the same shape as before: `cancelled` counts removed rows.
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
    try {
      const r = returnOrderInventory(id);
      if (r && r.restored) restored++;
    } catch (e) {
      console.error('[sweeper] restore failed for', id, e.message);
    }
    db.transaction(() => {
      db.prepare(`DELETE FROM commissions WHERE consumer_order_id=?`).run(id);
      db.prepare(`DELETE FROM consumer_order_items WHERE order_id=?`).run(id);
      db.prepare(`DELETE FROM consumer_orders WHERE id=?`).run(id);
    })();
    cancelled++;
  }
  if (cancelled) console.log(`[sweeper] removed ${cancelled} abandoned orders (restored ${restored})`);
  return { cancelled, restored, ids: stale.map(s => s.id) };
}

module.exports = { sweepAbandonedOrders, DEFAULT_STALE_MINUTES };
