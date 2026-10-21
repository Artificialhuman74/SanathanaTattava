/**
 * Product photos as links instead of inline data.
 *
 * Products keep their photos in the database as base64 data URIs, and every list, cart and order
 * used to send them inline: 849 KB for six products, re-downloaded on every visit and impossible to
 * cache. API responses now carry a link per photo instead; the photo itself is written once to the
 * data volume, named by its content hash, and served with a cache-forever header, so phones,
 * browsers and the CDN keep it.
 *
 * Admin pages still get the inline data: the product editor saves back whatever it loaded.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const DATA_URI = /^data:(image\/[a-z+.-]+);base64,/i;

// data URI → file name. Keyed by the string itself; the same photo comes back on every request.
const named = new Map();
const MAX_NAMED = 500;

/** Writes the photo in [dataUri] to the volume (once) and returns its file name, or null. */
function fileFor(dataUri) {
  const hit = named.get(dataUri);
  if (hit) return hit;
  const m = dataUri.match(DATA_URI);
  if (!m) return null;
  const ext = EXT[m[1].toLowerCase()];
  if (!ext) return null;
  const bytes = Buffer.from(dataUri.slice(m[0].length), 'base64');
  const name = `${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 20)}.${ext}`;
  const file = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(file)) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  }
  if (named.size >= MAX_NAMED) named.delete(named.keys().next().value);
  named.set(dataUri, name);
  return name;
}

function originOf(req) {
  // The CDN address (https://api.sanathanatattva.shop), so every app version, old ones calling
  // Railway directly included, fetches photos from the CDN's cache.
  if (process.env.PUBLIC_MEDIA_ORIGIN) return process.env.PUBLIC_MEDIA_ORIGIN.replace(/\/$/, '');
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('x-forwarded-host') || req.get('host')}`;
}

/** Swaps every inline photo in [value] for a link, keeping each field's type (string, array, JSON-in-a-string). */
function linkify(value, origin) {
  if (typeof value === 'string') {
    if (value.length < 64) return value;
    if (value.startsWith('data:image/')) {
      const name = fileFor(value);
      return name ? `${origin}/api/media/${name}` : value;
    }
    // image_urls is stored as a JSON array inside a string.
    if (value.startsWith('["data:image/')) {
      try {
        const list = JSON.parse(value);
        if (Array.isArray(list)) return JSON.stringify(list.map((v) => linkify(v, origin)));
      } catch (_) { /* not JSON after all */ }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => linkify(v, origin));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = linkify(value[k], origin);
    return out;
  }
  return value;
}

/** Express middleware: links instead of inline photos in JSON responses (not for admin pages). */
function linkPhotos(req, res, next) {
  if (req.path.startsWith('/api/admin')) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    try { return json(linkify(body, originOf(req))); }
    catch (err) {
      console.error('[media] linkify failed:', err.message);
      return json(body);
    }
  };
  next();
}

/** After a restart, a link from an earlier response may name a photo not yet seen: find it among the products. */
function findInProducts(name) {
  const rows = db.prepare("SELECT image_url, image_urls FROM products WHERE image_url LIKE 'data:image/%' OR image_urls LIKE '%data:image/%'").all();
  for (const row of rows) {
    const all = [row.image_url];
    try { const list = JSON.parse(row.image_urls || '[]'); if (Array.isArray(list)) all.push(...list); } catch (_) { /* ignore */ }
    for (const uri of all) {
      if (typeof uri === 'string' && uri.startsWith('data:image/') && fileFor(uri) === name) return true;
    }
  }
  return false;
}

const SAFE_NAME = /^[a-f0-9]{20}\.(jpg|png|webp|gif|avif)$/;

/** GET /api/media/:name — one photo, cached forever (the name changes when the photo does). */
function serveMedia(req, res) {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) return res.status(404).end();
  const file = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(file) && !findInProducts(name)) return res.status(404).end();
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.removeHeader('Access-Control-Allow-Credentials');
  res.sendFile(file, { maxAge: '365d', immutable: true });
}

module.exports = { linkPhotos, serveMedia, linkify, MEDIA_DIR };
