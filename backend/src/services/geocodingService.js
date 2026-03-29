/**
 * Geocoding Service
 *
 * Converts text addresses to latitude/longitude coordinates using
 * OpenStreetMap Nominatim (free, no API key required).
 *
 * Uses progressive simplification: if the full address fails,
 * tries shorter/simpler queries (city + pincode, just pincode, etc.)
 *
 * Rate limit: max 1 request per second (Nominatim usage policy).
 */

const https = require('https');
const { latLngToH3Index, isValidCoordinate } = require('./h3Service');

/* ── Configuration ───────────────────────────────────────────────────── */

const NOMINATIM_BASE  = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT      = 'TradeHub/1.0 (delivery-platform)';
const REQUEST_TIMEOUT = 10000;

/* ── Rate limiter: 1 req/sec for Nominatim ────────────────────────── */

let lastRequestTime = 0;

function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const waitMs = Math.max(0, 1100 - elapsed);
  return new Promise(resolve => setTimeout(resolve, waitMs));
}

/* ── Single Nominatim request ─────────────────────────────────────── */

function nominatimSearch(query) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      q:              query,
      format:         'json',
      limit:          '1',
      addressdetails: '0',
      countrycodes:   'in',
    });

    const url = `${NOMINATIM_BASE}?${params.toString()}`;

    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(body);
          if (!Array.isArray(results) || results.length === 0) {
            resolve(null);
            return;
          }
          const best = results[0];
          const lat = parseFloat(best.lat);
          const lon = parseFloat(best.lon);
          if (!isValidCoordinate(lat, lon)) { resolve(null); return; }
          resolve({ lat, lon, display_name: best.display_name || '' });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* ── Build progressive query variants ─────────────────────────────── */

function buildQueryVariants(address, pincode) {
  const variants = [];
  const clean = address.trim();
  const pin = (pincode || '').trim();

  // 1. Full address + pincode + India
  let q1 = clean;
  if (pin && !q1.includes(pin)) q1 += `, ${pin}`;
  if (!/india/i.test(q1)) q1 += ', India';
  variants.push(q1);

  // 2. Try with just the last 2-3 comma-separated parts (city, state) + pincode
  //    e.g. "942, 3rd Cross Road, Block 11, Nagarbhavi, Bangalore" → "Nagarbhavi, Bangalore"
  const parts = clean.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length > 2) {
    const short = parts.slice(-2).join(', ');
    let q2 = short;
    if (pin) q2 += `, ${pin}`;
    q2 += ', India';
    variants.push(q2);
  }

  // 3. Just pincode + India (pincode-level accuracy)
  if (pin) {
    variants.push(`${pin}, India`);
  }

  // 4. Try extracting city names from address (common Indian cities)
  const cityPatterns = /\b(Mumbai|Delhi|Bangalore|Bengaluru|Chennai|Kolkata|Hyderabad|Pune|Ahmedabad|Jaipur|Lucknow|Nagpur|Indore|Bhopal|Patna|Vadodara|Ghaziabad|Ludhiana|Agra|Nashik|Faridabad|Meerut|Rajkot|Varanasi|Srinagar|Thiruvananthapuram|Coimbatore|Mysore|Mysuru|Noida|Gurgaon|Gurugram|Thane|Navi Mumbai)\b/i;
  const cityMatch = clean.match(cityPatterns);
  if (cityMatch) {
    let q4 = cityMatch[1];
    if (pin) q4 += `, ${pin}`;
    q4 += ', India';
    // Only add if different from existing variants
    if (!variants.includes(q4)) variants.push(q4);
  }

  return variants;
}

/* ── Core: Geocode with progressive fallback ─────────────────────── */

/**
 * Geocode an address string to coordinates using progressive simplification.
 *
 * @param {string} address   Full text address
 * @param {string} [pincode] Optional pincode
 * @returns {Promise<{ latitude: number, longitude: number, h3_index: string, display_name: string } | null>}
 */
async function geocodeAddress(address, pincode) {
  if (!address || typeof address !== 'string' || !address.trim()) {
    return null;
  }

  const variants = buildQueryVariants(address, pincode);

  for (const query of variants) {
    await waitForRateLimit();
    lastRequestTime = Date.now();

    const result = await nominatimSearch(query);
    if (result) {
      const h3_index = latLngToH3Index(result.lat, result.lon);
      console.log(`[geocoding] "${query}" → ${result.lat.toFixed(6)}, ${result.lon.toFixed(6)} → H3: ${h3_index}`);
      return {
        latitude: result.lat,
        longitude: result.lon,
        h3_index,
        display_name: result.display_name,
      };
    }
    console.log(`[geocoding] No results for: "${query}", trying next variant...`);
  }

  console.log(`[geocoding] All variants failed for: "${address}"`);
  return null;
}

/**
 * Convert known coordinates to H3 index.
 * No external API call needed — just wraps H3 conversion.
 */
function geocodeFromCoordinates(latitude, longitude) {
  if (!isValidCoordinate(latitude, longitude)) return null;
  try {
    const h3_index = latLngToH3Index(latitude, longitude);
    return { latitude, longitude, h3_index };
  } catch {
    return null;
  }
}

/* ── Exports ─────────────────────────────────────────────────────────── */

module.exports = {
  geocodeAddress,
  geocodeFromCoordinates,
};
