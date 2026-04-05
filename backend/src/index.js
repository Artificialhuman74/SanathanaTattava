require('dotenv').config();
const express = require('express');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');
const helmet  = require('helmet');

const { initSocket } = require('./websocket/socketServer');

const authRoutes          = require('./routes/auth');
const adminRoutes         = require('./routes/admin');
const traderRoutes        = require('./routes/trader');
const consumerRoutes      = require('./routes/consumer');
const locationRoutes      = require('./routes/location');
const notificationRoutes  = require('./routes/notifications');
const deliveryRoutes      = require('./routes/delivery');
const paymentRoutes       = require('./routes/payments');

const app  = express();
const PORT = process.env.PORT || 5001;

// ─── Middleware ────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://sanathanatattva.shop',
  'https://www.sanathanatattva.shop',
  'http://localhost:3000',
  'https://localhost:3000',
  'http://localhost:5001',
  'https://localhost:5001',
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Allow any trycloudflare.com subdomain (temporary tunnels)
    if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return cb(null, true);
    // Allow any railway.app subdomain (preview deployments)
    if (/^https:\/\/[a-z0-9-]+\.railway\.app$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/trader',        traderRoutes);
app.use('/api/consumer',      consumerRoutes);
app.use('/api/location',      locationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/delivery',      deliveryRoutes);
app.use('/api/payments',      paymentRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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
if (!process.env.RAILWAY_ENVIRONMENT && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`\n🚀 TradeHub HTTPS Server + WebSocket Running`);
    console.log(`   Local:   https://localhost:${PORT}`);
    console.log(`   Network: https://${localIP}:${PORT}\n`);
  });
} else {
  const server = http.createServer(app);
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 TradeHub server listening on port ${PORT}\n`);
  });
}
