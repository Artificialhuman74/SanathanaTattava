/**
 * Road routes for the live maps (ST Partner app + customer tracking): the line drawn from the
 * rider or shop to the destination. Navigation itself is handed to Google Maps.
 *
 *   GET /api/route?from=12.93,77.58&to=12.95,77.60
 *     → { points: [[lat, lng], …], metres, seconds }
 *
 * The backend asks our own OSRM server (`OSRM_URL`, the Railway "osrm" service built from
 * /osrm). Without it, it falls back to the public OSRM demo server, which is fine for testing
 * but not allowed for production traffic.
 */
const express = require('express');

const router = express.Router();

const PUBLIC_DEMO = 'https://router.project-osrm.org';
const osrmBase = () => (process.env.OSRM_URL || PUBLIC_DEMO).replace(/\/+$/, '');

// Routes barely change: cache them (keyed to ~10 m) so a jittery GPS doesn't refetch.
const CACHE_MAX = 1000;
const CACHE_MS = 15 * 60_000;
const cache = new Map();

// A small per-IP limit; the maps ask about once per GPS fix.
const WINDOW_MS = 60_000;
const PER_WINDOW = 60;
const hits = new Map();

function limited(ip, now) {
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > PER_WINDOW;
}

function point(raw) {
  const [lat, lng] = String(raw || '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

router.get('/', async (req, res) => {
  const from = point(req.query.from);
  const to = point(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'from and to must be "lat,lng"' });
  const now = Date.now();
  // Behind Cloudflare, the caller is in CF-Connecting-IP (req.ip would be the edge, shared by many).
  if (limited(req.get('cf-connecting-ip') || req.ip, now)) return res.status(429).json({ error: 'Too many route requests' });

  const r = (v) => v.toFixed(4);
  const key = `${r(from.lng)},${r(from.lat)};${r(to.lng)},${r(to.lat)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return res.set('Cache-Control', 'public, max-age=300').json(hit.route);

  try {
    const upstream = await fetch(`${osrmBase()}/route/v1/driving/${key}?overview=full&geometries=geojson`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!upstream.ok) return res.status(502).json({ error: 'Routing server error' });
    const body = await upstream.json();
    const best = body.routes?.[0];
    if (!best) return res.status(404).json({ error: 'No road route found' });
    const route = {
      points: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      metres: best.distance,
      seconds: best.duration,
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now, route });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(route);
  } catch (err) {
    console.error('[route] OSRM unavailable:', err.message);
    res.status(503).json({ error: 'Routing is unavailable right now' });
  }
});

module.exports = router;
module.exports._reset = () => { cache.clear(); hits.clear(); };
