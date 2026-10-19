/**
 * One origin allowlist for both HTTP (cors middleware in index.js) and
 * Socket.IO (websocket/socketServer.js). They used to keep separate lists,
 * and the socket one fell behind: partner.* and delivery.* were missing, so
 * the admin/trader sites couldn't open a live connection.
 */
const allowedOrigins = [
  'https://sanathanatattva.shop',
  'https://www.sanathanatattva.shop',
  'https://partner.sanathanatattva.shop',
  'https://delivery.sanathanatattva.shop',
  'http://localhost:3000',
  'https://localhost:3000',
  'http://localhost:3001', // npm run dev:partner (admin + trader)
  'http://localhost:5001',
  'https://localhost:5001',
];
if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(',').map(s => s.trim()).filter(Boolean).forEach(o => allowedOrigins.push(o));
}
// Named Cloudflare tunnel — stays constant, no regex needed
if (process.env.API_ORIGIN) allowedOrigins.push(process.env.API_ORIGIN);

function isAllowedOrigin(origin) {
  // Requests with no origin (mobile apps, curl, same-origin)
  if (!origin || allowedOrigins.includes(origin)) return true;
  // Any trycloudflare.com subdomain (temporary tunnels)
  if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return true;
  // Any Netlify deployment origin
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return true;
  // Railway deployments: foo.railway.app, foo.up.railway.app
  if (/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.railway\.app$/.test(origin)) return true;
  return false;
}

module.exports = { allowedOrigins, isAllowedOrigin };
