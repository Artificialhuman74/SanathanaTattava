/**
 * H3 Geospatial Indexing Service
 *
 * Wraps the Uber H3 library to provide:
 *   - Lat/lng → H3 index conversion
 *   - kRing neighbour expansion
 *   - Haversine distance calculation
 *
 * Resolution 9 ≈ ~174 m edge-length hexagons — fine enough for
 * urban delivery zones while keeping the index count manageable.
 */

const h3 = require('h3-js');

/* ── Configuration ───────────────────────────────────────────────────── */

const H3_RESOLUTION   = 7;      // ~1.22 km edge → ~5.16 km² per cell (good for delivery zones)
const MAX_K_RING      = 10;     // at res 7, kRing=10 covers ~120 km² — suitable for city-wide delivery
const EARTH_RADIUS_KM = 6371;   // mean Earth radius in km

/* ── Core Helpers ────────────────────────────────────────────────────── */

/**
 * Convert a lat/lng pair to an H3 index string.
 * @param {number} lat  Latitude  (-90 … 90)
 * @param {number} lng  Longitude (-180 … 180)
 * @returns {string} H3 index hex string
 */
function latLngToH3Index(lat, lng) {
  if (!isValidCoordinate(lat, lng)) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
  }
  return h3.latLngToCell(lat, lng, H3_RESOLUTION);
}

/**
 * Return the set of H3 cells within `k` rings of `h3Index`.
 * Ring 0 = the cell itself; ring 1 = immediate neighbours, etc.
 * @param {string} h3Index
 * @param {number} k  Number of rings (≥ 0)
 * @returns {string[]} Array of H3 index strings
 */
function getKRing(h3Index, k = 1) {
  return h3.gridDisk(h3Index, k);
}

/**
 * Get the center lat/lng of an H3 cell.
 * @param {string} h3Index
 * @returns {{ lat: number, lng: number }}
 */
function h3ToLatLng(h3Index) {
  const [lat, lng] = h3.cellToLatLng(h3Index);
  return { lat, lng };
}

/* ── Distance ────────────────────────────────────────────────────────── */

/**
 * Haversine distance between two lat/lng points.
 * @returns {number} Distance in kilometres
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Validation ──────────────────────────────────────────────────────── */

/**
 * Check that latitude and longitude are valid numbers within range.
 */
function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Validate an H3 index string.
 */
function isValidH3Index(index) {
  return typeof index === 'string' && h3.isValidCell(index);
}

/* ── Exports ─────────────────────────────────────────────────────────── */

module.exports = {
  H3_RESOLUTION,
  MAX_K_RING,
  latLngToH3Index,
  getKRing,
  h3ToLatLng,
  haversineDistance,
  isValidCoordinate,
  isValidH3Index,
};
