/**
 * One-time sweeper: assign all consumers with no linked dealer to admin.
 *
 * Safe to run multiple times — only touches rows where linked_dealer_id IS NULL.
 *
 * Usage:
 *   node scripts/assignUnlinkedConsumers.js
 *   node scripts/assignUnlinkedConsumers.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../src/database/db');

const isDryRun = process.argv.includes('--dry-run');

function run() {
  const admin = db.prepare(`
    SELECT id, name, email FROM users
    WHERE role = 'admin' AND status = 'active'
    ORDER BY id LIMIT 1
  `).get();

  if (!admin) {
    console.error('[sweeper] No active admin user found — aborting.');
    process.exit(1);
  }

  const unlinked = db.prepare(`
    SELECT id, name, email FROM consumers
    WHERE linked_dealer_id IS NULL AND status = 'active'
  `).all();

  console.log(`[sweeper] Found ${unlinked.length} unlinked consumer(s).`);
  console.log(`[sweeper] Will assign to admin: ${admin.name} (id=${admin.id}, ${admin.email})`);

  if (isDryRun) {
    console.log('[sweeper] --dry-run: no changes written.');
    unlinked.forEach(c => console.log(`  • Consumer id=${c.id} "${c.name}" ${c.email}`));
    return;
  }

  if (unlinked.length === 0) {
    console.log('[sweeper] Nothing to do.');
    return;
  }

  const update = db.prepare(`
    UPDATE consumers SET linked_dealer_id = ? WHERE id = ?
  `);

  const assign = db.transaction(() => {
    for (const c of unlinked) {
      update.run(admin.id, c.id);
    }
  });

  assign();

  console.log(`[sweeper] Done — assigned ${unlinked.length} consumer(s) to admin id=${admin.id}.`);
}

run();
