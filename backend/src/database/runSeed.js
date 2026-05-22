/**
 * runSeed.js
 *
 * Checks whether the database is empty (no users table or users table has no
 * rows) and, if so, runs the seed script to populate it with test data.
 * Called once at application startup after the database is initialised.
 */

const { execSync } = require('child_process');
const path = require('path');

async function runSeedIfEmpty() {
  try {
    const db = require('./db');

    // Check whether the users table exists and has at least one row
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM sqlite_master
         WHERE type='table' AND name='users'`
      )
      .get();

    const tableExists = row && row.cnt > 0;

    if (tableExists) {
      const { cnt: userCount } = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
      if (userCount > 0) {
        console.log(`[runSeed] Database already has ${userCount} user(s) — skipping seed.`);
        return;
      }
    }

    console.log('[runSeed] Database is empty — running seed script…');

    const seedPath = path.join(__dirname, 'seed.js');
    execSync(`node "${seedPath}"`, {
      stdio: 'inherit',
      env: process.env,
    });

    console.log('[runSeed] ✅ Seed completed successfully.');
  } catch (err) {
    console.error('[runSeed] ❌ Seed failed:', err.message);
  }
}

module.exports = { runSeedIfEmpty };
