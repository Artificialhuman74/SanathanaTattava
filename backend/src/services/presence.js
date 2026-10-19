/**
 * One online/offline state for a delivery partner, shared by the ST Partner app
 * (partner_online) and the website (availability_status + will_deliver, which the
 * website's availability toggle has always set together: available ⇔ will_deliver=1).
 *
 * Going Online in the app means "I'll deliver now", so dispatch offers the order to
 * the shop instead of treating it as pack-only; going Offline (by hand, or the
 * auto-offline after missed orders) means the opposite. Every writer of these
 * fields goes through here so the two sides can't drift apart again.
 */
const db = require('../database/db');

function setOnline(userId, online, extra = {}) {
  const cols = {
    partner_online: online ? 1 : 0,
    availability_status: online ? 'available' : 'offline',
    will_deliver: online ? 1 : 0,
    ...extra,
  };
  const keys = Object.keys(cols);
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => cols[k]), userId);
}

module.exports = { setOnline };
