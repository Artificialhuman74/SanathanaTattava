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

const app  = express();
const PORT = process.env.PORT || 5001;

// ─── Middleware ────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://sanathanatattva.shop',
  'https://www.sanathanatattva.shop',
  'http://localhost:3000',
  'https://localhost:3000',
  'http://localhost:5001',
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
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

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Serve built frontend (production) ────────────────────────────────────
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

// ─── Global error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start server with Socket.IO ──────────────────────────────────────────
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

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const options = {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  const server = https.createServer(options, app);
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('\n🚀 TradeHub HTTPS Server + WebSocket Running');
    console.log('─────────────────────────────────────────');
    console.log(`  Local:    https://localhost:${PORT}`);
    console.log(`  Network:  https://${localIP}:${PORT}  ← Use this on your phone`);
    console.log('─────────────────────────────────────────\n');
  });
} else {
  const server = http.createServer(app);
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n⚠️  Running in HTTP mode (no SSL certs found)');
    console.log(`   Run generate-certs.sh first for HTTPS`);
    console.log(`   http://localhost:${PORT}\n`);
  });
}
