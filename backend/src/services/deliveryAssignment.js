/**
 * Delivery Assignment Service
 *
 * Responsible for finding the nearest available dealer to fulfil a
 * consumer order delivery, using H3 spatial indexing for fast candidate
 * look-ups and the Haversine formula for precise distance ranking.
 *
 * Flow:
 *   1. Convert customer location → H3 index
 *   2. Start with kRing = 1 and expand outward
 *   3. Query dealers whose h3_index falls within the ring
 *   4. Filter: availability_status = 'available',
 *              delivery_enabled = 1, will_deliver = 1
 *   5. Rank by Haversine distance
 *   6. Return the closest dealer
 *
 * If no dealer is found after MAX_K_RING expansions, returns null.
 */

const db = require('../database/db');
const {
  latLngToH3Index,
  getKRing,
  haversineDistance,
  isValidCoordinate,
  MAX_K_RING,
} = require('./h3Service');

/* ── Main Public API ─────────────────────────────────────────────────── */

/**
 * Find the nearest available delivery dealer for a given location.
 *
 * @param {number}  customerLat   Customer latitude
 * @param {number}  customerLng   Customer longitude
 * @param {number|null} excludeDealerId  Optional dealer id to exclude
 *                                       (e.g. the referral dealer if the
 *                                        caller wants a *different* driver)
 * @returns {{ dealer: object, distanceKm: number } | null}
 */
function findNearestDealer(customerLat, customerLng, excludeDealerId = null) {
  if (!isValidCoordinate(customerLat, customerLng)) {
    throw new Error('Invalid customer coordinates for delivery assignment');
  }

  const customerH3 = latLngToH3Index(customerLat, customerLng);

  for (let k = 1; k <= MAX_K_RING; k++) {
    const ring   = getKRing(customerH3, k);
    const result = queryDealersInCells(ring, customerLat, customerLng, excludeDealerId);

    if (result) return result;              // found at least one
  }

  return null;                               // nobody within max radius
}

/**
 * Find the N closest available dealers (useful for fallback / UI lists).
 *
 * @param {number} customerLat
 * @param {number} customerLng
 * @param {number} limit   Max dealers to return (default 5)
 * @returns {Array<{ dealer: object, distanceKm: number }>}
 */
function findNearbyDealers(customerLat, customerLng, limit = 5) {
  if (!isValidCoordinate(customerLat, customerLng)) {
    throw new Error('Invalid customer coordinates');
  }

  const customerH3 = latLngToH3Index(customerLat, customerLng);
  const candidates = [];

  for (let k = 1; k <= MAX_K_RING; k++) {
    const ring = getKRing(customerH3, k);
    const found = queryAllDealersInCells(ring, customerLat, customerLng);
    candidates.push(...found);

    // De-duplicate (a dealer may appear in overlapping rings)
    const seen = new Set();
    const unique = candidates.filter(c => {
      if (seen.has(c.dealer.id)) return false;
      seen.add(c.dealer.id);
      return true;
    });

    if (unique.length >= limit) {
      return unique
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);
    }
  }

  // Return whatever we found (may be < limit)
  const seen = new Set();
  return candidates
    .filter(c => {
      if (seen.has(c.dealer.id)) return false;
      seen.add(c.dealer.id);
      return true;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/**
 * Assign the nearest available dealer to a consumer order and persist.
 *
 * @param {number} orderId        consumer_orders.id
 * @param {number} customerLat    customer latitude
 * @param {number} customerLng    customer longitude
 * @param {number|null} referralDealerId  the linked/referral dealer (for exclusion opt.)
 * @returns {{ deliveryDealerId: number, distanceKm: number } | null}
 */
function assignDeliveryDealer(orderId, customerLat, customerLng, referralDealerId = null) {
  // We do NOT exclude the referral dealer — they can still be the
  // nearest delivery driver.  Pass `excludeDealerId` only if the
  // business rule explicitly requires a *different* person.
  const match = findNearestDealer(customerLat, customerLng);

  if (!match) return null;

  db.prepare(`
    UPDATE consumer_orders
    SET    delivery_dealer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE  id = ?
  `).run(match.dealer.id, orderId);

  return {
    deliveryDealerId: match.dealer.id,
    deliveryDealerName: match.dealer.name,
    deliveryDealerPhone: match.dealer.phone,
    distanceKm: match.distanceKm,
  };
}

/* ── Internal Helpers ────────────────────────────────────────────────── */

/**
 * Query the DB for available delivery dealers whose h3_index is in the
 * given set of cells, then return the single closest one.
 */
function queryDealersInCells(cells, customerLat, customerLng, excludeId) {
  if (cells.length === 0) return null;

  const placeholders = cells.map(() => '?').join(',');

  let sql = `
    SELECT id, name, phone, tier, latitude, longitude, h3_index,
           availability_status, referral_code
    FROM   users
    WHERE  h3_index IN (${placeholders})
      AND  role = 'trader'
      AND  status = 'active'
      AND  delivery_enabled = 1
      AND  will_deliver = 1
      AND  availability_status = 'available'
      AND  latitude IS NOT NULL
      AND  longitude IS NOT NULL
  `;
  const params = [...cells];

  if (excludeId) {
    sql += ` AND id != ?`;
    params.push(excludeId);
  }

  const dealers = db.prepare(sql).all(...params);

  if (dealers.length === 0) return null;

  let best = null;
  let bestDist = Infinity;

  for (const d of dealers) {
    const dist = haversineDistance(customerLat, customerLng, d.latitude, d.longitude);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }

  return best ? { dealer: best, distanceKm: round(bestDist, 3) } : null;
}

/**
 * Same as above but returns ALL matching dealers (for the nearby list).
 */
function queryAllDealersInCells(cells, customerLat, customerLng) {
  if (cells.length === 0) return [];

  const placeholders = cells.map(() => '?').join(',');
  const dealers = db.prepare(`
    SELECT id, name, phone, tier, latitude, longitude, h3_index,
           availability_status, referral_code
    FROM   users
    WHERE  h3_index IN (${placeholders})
      AND  role = 'trader'
      AND  status = 'active'
      AND  delivery_enabled = 1
      AND  will_deliver = 1
      AND  availability_status = 'available'
      AND  latitude IS NOT NULL
      AND  longitude IS NOT NULL
  `).all(...cells);

  return dealers.map(d => ({
    dealer: d,
    distanceKm: round(
      haversineDistance(customerLat, customerLng, d.latitude, d.longitude),
      3,
    ),
  }));
}

function round(num, decimals) {
  const f = 10 ** decimals;
  return Math.round(num * f) / f;
}

/* ── Exports ─────────────────────────────────────────────────────────── */

module.exports = {
  findNearestDealer,
  findNearbyDealers,
  assignDeliveryDealer,
};
