require('dotenv').config();

const fs   = require('fs');
const path = require('path');

// ─── Persistent file logger ───────────────────────────────────────────────
// Tees console.log / console.error to a daily rotating file in DATA_DIR/logs/.
// On Railway, DATA_DIR=/data is a mounted Volume — survives deployments.
// Locally it falls back to ../../data/logs/ which is git-ignored.
(function setupFileLogging() {
  const dataDir  = process.env.DATA_DIR || path.join(__dirname, '../../data');
  const logsDir  = path.join(dataDir, 'logs');
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}

  let currentDay  = '';
  let logStream   = null;

  function getStream() {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (day !== currentDay) {
      if (logStream) try { logStream.end(); } catch (_) {}
      currentDay = day;
      const file = path.join(logsDir, `app-${day}.log`);
      logStream = fs.createWriteStream(file, { flags: 'a' });
    }
    return logStream;
  }

  function write(...args) {
    const line = `[${new Date().toISOString()}] ${args.map(a =>
      typeof a === 'string' ? a : JSON.stringify(a)
    ).join(' ')}\n`;
    try { getStream().write(line); } catch (_) {}
  }

  const origLog   = console.log.bind(console);
  const origError = console.error.bind(console);
  console.log   = (...args) => { origLog(...args);   write(...args); };
  console.error = (...args) => { origError(...args); write('[ERROR]', ...args); };

  // Prune log files older than 30 days (runs once at startup)
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    fs.readdirSync(logsDir).forEach(f => {
      if (!f.startsWith('app-')) return;
      const full = path.join(logsDir, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    });
  } catch (_) {}
})();

// Express 4 does not catch async errors — Node.js v20 exits on unhandled rejections.
// Log them and keep the server alive; individual requests will timeout/fail gracefully.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const express = require('express');
const https   = require('https');
const http    = require('http');
const cors    = require('cors');
const helmet  = require('helmet');

const { initSocket } = require('./websocket/socketServer');
const db = require('./database/db');

const authRoutes          = require('./routes/auth');
const adminRoutes         = require('./routes/admin');
const traderRoutes        = require('./routes/trader');
const consumerRoutes      = require('./routes/consumer');
const locationRoutes      = require('./routes/location');
const notificationRoutes  = require('./routes/notifications');
const deliveryRoutes      = require('./routes/delivery');
const paymentRoutes       = require('./routes/payments');
const publicRoutes        = require('./routes/public');
const financeRoutes       = require('./routes/finance');
const luckyDrawRoutes     = require('./routes/luckyDraw');
const devToolsRoutes      = require('./routes/devTools');

const app  = express();
const PORT = process.env.PORT || 5001;

// ─── Middleware ────────────────────────────────────────────────────────────
const { isAllowedOrigin } = require('./config/corsOrigins');

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // Enable CORS preflight for all routes

const requestId = require('./middleware/requestId');
app.use(requestId);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Razorpay webhook MUST receive raw bytes for HMAC verification — register
// before the global JSON parser so req.body stays a Buffer for this route.
app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Static uploads (refund proof + damage photos) ────────────────────────
// Lives on the same DATA_DIR volume as the SQLite DB so it survives redeploys.
const { UPLOADS_DIR } = require('./middleware/uploadProof');
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(UPLOADS_DIR, {
  maxAge: '7d',
  fallthrough: true,
  dotfiles: 'ignore',
}), (req, res) => {
  const resolved = path.join(UPLOADS_DIR, req.path);
  console.warn(`[uploads] miss ${req.path} (resolved=${resolved}, exists=${fs.existsSync(resolved)})`);
  res.status(404).json({ error: 'File not found', path: req.path });
});

// Diagnostic: lists which subdirs/files exist under UPLOADS_DIR on the
// running container — confirms volume mount + file persistence.
app.get('/api/__uploads-debug', (_req, res) => {
  try {
    const tree = {};
    if (!fs.existsSync(UPLOADS_DIR)) {
      return res.json({ UPLOADS_DIR, exists: false });
    }
    for (const sub of fs.readdirSync(UPLOADS_DIR)) {
      const subPath = path.join(UPLOADS_DIR, sub);
      if (fs.statSync(subPath).isDirectory()) {
        tree[sub] = fs.readdirSync(subPath).slice(0, 50);
      }
    }
    res.json({ UPLOADS_DIR, exists: true, tree, DATA_DIR: process.env.DATA_DIR || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/admin/finance', financeRoutes);
app.use('/api/admin/riders',  require('./routes/adminRiders'));
app.use('/api/admin/dispatch', require('./routes/adminDispatch'));
app.use('/api/admin',         adminRoutes);
app.use('/api/trader',        traderRoutes);
app.use('/api/consumer',      require('./routes/consumerTracking'));
app.use('/api/consumer',      consumerRoutes);
app.use('/api/location',      locationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/delivery',      deliveryRoutes);
app.use('/api/rider',         require('./routes/rider'));
app.use('/api/devices',       require('./routes/devices'));
app.use('/api/partner/orders', require('./routes/partnerOrders'));
app.use('/api/partner',       require('./routes/partner'));
app.use('/api/payments',      paymentRoutes);
app.use('/api/invoice',       require('./routes/invoices'));
app.use('/api/route',         require('./routes/routing'));
app.use('/api/public',        publicRoutes);
app.use('/api/lucky-draw',    luckyDrawRoutes);
app.use('/api/dev-tools',     devToolsRoutes);

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', error: err.message });
  }
});

app.get('/', (_req, res) => res.json({ name: 'Sanathana Tattva API', status: 'running' }));

// ─── Review email scheduler — runs every hour ──────────────────────────────
// Finds orders delivered 2+ days ago that haven't had review emails sent yet,
// generates per-product tokens, and sends the review request email.
function scheduleReviewEmails() {
  try {
    const db = require('./database/db');
    const crypto = require('crypto');
    const { sendReviewRequestEmail } = require('./services/emailService');
    const { getPublicSiteUrl } = require('./utils/publicUrl');
    const FRONTEND = getPublicSiteUrl();

    const orders = db.prepare(`
      SELECT co.id as order_id, co.consumer_id, c.email, c.name as consumer_name
      FROM consumer_orders co
      JOIN consumers c ON c.id = co.consumer_id
      WHERE co.delivery_status = 'delivered'
        AND co.review_email_sent = 0
        AND co.delivery_verified_at <= datetime('now', '-2 days')
        AND c.email IS NOT NULL
    `).all();

    for (const order of orders) {
      const items = db.prepare(`
        SELECT DISTINCT oi.product_id, p.name as product_name
        FROM consumer_order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?
      `).all(order.order_id);

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      for (const item of items) {
        const token = crypto.randomUUID();
        db.prepare(`
          INSERT OR IGNORE INTO review_tokens (consumer_id, product_id, order_id, token, expires_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(order.consumer_id, item.product_id, order.order_id, token, expiresAt);
        const reviewUrl = `${FRONTEND}/shop/review?token=${token}&pid=${item.product_id}`;
        sendReviewRequestEmail(order.email, order.consumer_name, item.product_name, reviewUrl)
          .catch(err => console.error('[review-email] failed:', err.message));
      }

      db.prepare('UPDATE consumer_orders SET review_email_sent = 1 WHERE id = ?').run(order.order_id);
    }
    if (orders.length) console.log(`[review-scheduler] sent review emails for ${orders.length} orders`);
  } catch (err) {
    console.error('[review-scheduler] error:', err.message);
  }
}

// Run once at startup (catches any missed while server was down) and then hourly
setTimeout(scheduleReviewEmails, 60_000);
setInterval(scheduleReviewEmails, 60 * 60 * 1000);

/* ── Automated weekly payouts (admin-configurable day/time, IST) ─────────── */
const { startPayoutScheduler } = require('./services/payoutScheduler');
startPayoutScheduler();

// ─── Bhagya Chakra monthly draw — 12th at 5PM IST by default ───────────────
const { startDrawScheduler } = require('./services/luckyDraw/drawScheduler');
startDrawScheduler();

/* ── ST Partner dispatch: rings, re-rings, escalation, admin alerts (every 30 s) ── */
const dispatch = require('./services/dispatch');
setInterval(() => { dispatch.tick().catch((err) => console.error('[dispatch] tick:', err.message)); }, 30_000);

/* ── Abandoned-order sweeper ──────────────────────────────────────────────── */
const { sweepAbandonedOrders } = require('./services/orderSweeperService');
function runSweeper() {
  try { sweepAbandonedOrders(); }
  catch (err) { console.error('[sweeper] error:', err.message); }
}
setTimeout(runSweeper, 90_000);
setInterval(runSweeper, 10 * 60 * 1000);

/* ── Container-finance proof retention ────────────────────────────────────
 * After a holding has been resolved for 30 days we delete any stored proof
 * images from disk and null the columns. The audit row in
 * container_finance_log keeps the historical reference. */
function purgeStaleContainerProofs() {
  try {
    const rows = db.prepare(`
      SELECT id, refund_proof_url, damage_photo_url
        FROM container_holdings
       WHERE resolved_at IS NOT NULL
         AND resolved_at < datetime('now', '-30 days')
         AND (refund_proof_url IS NOT NULL OR damage_photo_url IS NOT NULL)
    `).all();
    let purged = 0;
    for (const row of rows) {
      for (const kind of ['refund_proof_url', 'damage_photo_url']) {
        const url = row[kind];
        if (!url) continue;
        const rel = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null;
        if (rel) {
          const abs = path.join(UPLOADS_DIR, rel);
          try { if (fs.existsSync(abs)) fs.unlinkSync(abs); }
          catch (e) { console.warn(`[proof-purge] unlink ${abs}: ${e.message}`); }
        }
        const col = kind === 'refund_proof_url' ? 'refund_proof_url' : 'damage_photo_url';
        db.prepare(`UPDATE container_holdings SET ${col}=NULL WHERE id=?`).run(row.id);
        purged++;
      }
    }
    if (purged) console.log(`[proof-purge] removed ${purged} stale proof file(s)`);
  } catch (err) {
    console.error('[proof-purge] error:', err.message);
  }
}
setTimeout(purgeStaleContainerProofs, 120_000);
setInterval(purgeStaleContainerProofs, 60 * 60 * 1000);

// ─── Global error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────
// Railway (and most PaaS) terminate SSL at the proxy — always run HTTP here.
// For local dev with HTTPS, keep certs in backend/certs/ and they'll be used.
const certsDir = path.join(__dirname, '../certs');
const keyPath  = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');

const getLocalIP = () => {
  try {
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {}
  return 'localhost';
};

// Use HTTPS locally if certs exist, plain HTTP on Railway/cloud
let server;
if (!process.env.RAILWAY_ENVIRONMENT && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`\n🚀 TradeHub HTTPS Server + WebSocket Running`);
    console.log(`   Local:   https://localhost:${PORT}`);
    console.log(`   Network: https://${localIP}:${PORT}\n`);
  });
} else {
  server = http.createServer(app);
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 TradeHub server listening on port ${PORT}\n`);
  });
}

function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received — draining connections`);
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  // Force exit after 10s if connections don't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
