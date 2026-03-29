# TradeHub — Full Project Context for Claude

## What This Project Is

TradeHub is a multi-role distribution/trading platform called **SanathanaTattva**, live at `https://sanathanatattva.shop`. It manages a supply chain between an admin, traders (dealers), consumers, and delivery agents.

**GitHub repo:** `Artificialhuman74/SanathanaTattva`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js + Express + Socket.IO |
| Database | SQLite via `better-sqlite3` |
| Real-time | Socket.IO (WebSockets with polling fallback) |
| Auth | JWT tokens |
| Frontend hosting | Netlify → `sanathanatattva.shop` |
| Backend hosting | Developer's local laptop, exposed via cloudflared tunnel |

---

## User Roles

There are 4 roles in the system:

1. **Admin** — full platform control, inventory, orders, commissions, settings
2. **Trader / Dealer** — places orders, sees their own inventory, earns commissions
3. **Consumer** — shops for products, places consumer orders
4. **Delivery** — handles deliveries for consumer orders

Each role has its own layout, routes, and auth middleware.

---

## Project Structure

```
test-project/
├── frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── api/
│   │   │   └── axios.ts        # Axios instance for trader/admin (uses `token`)
│   │   ├── contexts/
│   │   │   ├── AuthContext.tsx # Auth state + consumerApi (uses `consumer_token`)
│   │   │   └── SocketContext.tsx # Socket.IO connection (uses VITE_API_URL)
│   │   ├── layouts/
│   │   │   ├── AdminLayout.tsx
│   │   │   ├── TraderLayout.tsx
│   │   │   ├── ConsumerLayout.tsx
│   │   │   └── DeliveryLayout.tsx
│   │   ├── components/
│   │   │   └── NotificationBell.tsx  # Shared bell (3 variants: dealer/admin/consumer)
│   │   ├── services/
│   │   │   └── notificationSound.ts  # Web Audio chime + browser push notifications
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   ├── trader/
│   │   │   ├── consumer/
│   │   │   └── delivery/
│   │   └── vite-env.d.ts       # Vite type declarations for import.meta.env
│   ├── netlify.toml            # Netlify build config + SPA redirect rules
│   └── .env.production.example # Template for env vars
│
└── backend/                    # Node.js + Express + Socket.IO
    ├── src/
    │   ├── index.js            # Main server entry point
    │   ├── database/
    │   │   ├── db.js           # SQLite setup (DATA_DIR env var configurable)
    │   │   ├── migrations.js   # Schema migrations
    │   │   └── seed.js         # Seed script
    │   ├── routes/
    │   │   ├── auth.js
    │   │   ├── admin.js
    │   │   ├── trader.js
    │   │   ├── consumer.js
    │   │   ├── location.js
    │   │   ├── notifications.js  # dealer + admin + consumer notification endpoints
    │   │   └── delivery.js
    │   ├── services/
    │   │   ├── notificationService.js
    │   │   └── inventoryService.js
    │   ├── middleware/
    │   │   └── auth.js          # authenticate, requireAdmin, requireTrader
    │   └── websocket/
    │       └── socketServer.js  # Socket.IO server setup
    └── data/
        └── database.db          # SQLite database file
```

---

## Authentication

- **Traders / Admin**: JWT stored as `token` in `localStorage`
- **Consumers**: JWT stored as `consumer_token` in `localStorage`
- There are **two separate axios instances**:
  - `api` (from `src/api/axios.ts`) — sends `token` header → used by trader/admin pages
  - `consumerApi` (from `src/contexts/AuthContext.tsx`) — sends `consumer_token` header → used by consumer pages
- Socket.IO auth: picks up whichever token is present (`token` || `consumer_token`)

---

## API Routes

All routes are prefixed with `/api`:

| Prefix | File | Auth |
|--------|------|------|
| `/api/auth` | routes/auth.js | Public |
| `/api/admin` | routes/admin.js | `authenticate` + `requireAdmin` |
| `/api/trader` | routes/trader.js | `authenticate` + `requireTrader` |
| `/api/consumer` | routes/consumer.js | Consumer JWT |
| `/api/location` | routes/location.js | Mixed |
| `/api/notifications/dealer` | routes/notifications.js | `authenticate` + `requireTrader` |
| `/api/notifications/admin` | routes/notifications.js | `authenticate` + `requireAdmin` |
| `/api/notifications/consumer` | routes/notifications.js | Consumer JWT |
| `/api/delivery` | routes/delivery.js | Mixed |
| `/api/health` | index.js | Public |

---

## Environment Variables

### Frontend (set in Netlify dashboard)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Full URL of the backend (e.g. `https://xyz.trycloudflare.com`). Empty in local dev (Vite proxy handles it). |

### Backend (set in `.env` file or environment)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `5001`) |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `DATA_DIR` | Path to SQLite data directory (default: `../../data` relative to db.js) |
| `FRONTEND_URL` | Additional CORS origin to allow (optional, for custom domains) |

---

## CORS Configuration

Backend (`src/index.js`) explicitly allows these origins:

```js
const allowedOrigins = [
  'https://sanathanatattva.shop',
  'https://www.sanathanatattva.shop',
  'http://localhost:3000',
  'https://localhost:3000',
  'http://localhost:5001',
  // + process.env.FRONTEND_URL if set
];
```

---

## Notifications System

### In-app bell (`NotificationBell.tsx`)
- Has 3 variants via prop: `variant="dealer"` | `"admin"` | `"consumer"`
- Each variant hits a different API endpoint and uses the correct auth token
- Fetches on mount + receives real-time updates via Socket.IO `notification` event

### Sound (`notificationSound.ts`)
- Two-tone chime (C5 → E5) synthesized via Web Audio API (no audio files needed)
- Sound can be toggled on/off — preference saved to `localStorage` (`tradehub_sound_enabled`)
- Toggling unmute plays a preview

### Browser push notifications
- Uses the Web Notifications API (native OS notifications)
- Permission requested on first real notification (not on page load)
- "Enable push notifications" banner shown inside the dropdown
- Shows when tab is in background or dropdown is closed
- Auto-closes after 6 seconds

### Bell animation
- Bell icon wiggles for 0.6s on new notification via `animate-wiggle` (defined in `tailwind.config.js`)

---

## Deployment Architecture

```
User's browser
      │
      ▼
Netlify CDN
(sanathanatattva.shop)
React SPA — static files
      │  VITE_API_URL
      ▼
cloudflared tunnel
(https://xxxx.trycloudflare.com)
      │
      ▼
Developer's laptop
Node.js backend
(https://localhost:5001)
      │
      ▼
SQLite database
(backend/data/database.db)
```

### Important deployment notes

1. **Backend runs on HTTPS locally** (self-signed certs in `backend/certs/`). If certs don't exist, it falls back to HTTP.
2. **cloudflared tunnel must point to `https://localhost:5001`** (not `http://`) because the backend has SSL certs.
   ```bash
   cloudflared tunnel --url https://localhost:5001
   ```
3. **Tunnel URL is temporary** — it changes every restart. When it changes:
   - Update `VITE_API_URL` in Netlify environment variables
   - Trigger a new Netlify deploy
4. **To make tunnel URL permanent**: Set up a named Cloudflare tunnel pointing to `api.sanathanatattva.shop`

### Keeping backend running

```bash
npm install -g pm2
pm2 start src/index.js --name tradehub-backend
pm2 start "cloudflared tunnel --url https://localhost:5001" --name tunnel
pm2 save
```

---

## Local Development

```bash
# Terminal 1 — Backend
cd backend
npm install
npm run dev       # starts on https://localhost:5001

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev       # starts on http://localhost:3000
                  # Vite proxies /api and /socket.io to localhost:5001
```

In local dev, `VITE_API_URL` is NOT set — Vite's proxy config handles routing to the backend automatically.

---

## Netlify Configuration

File: `frontend/netlify.toml`

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from   = "/*"
  to     = "/index.html"
  status = 200          # SPA fallback — all routes serve index.html
```

Build settings in Netlify dashboard:
- **Base directory**: `frontend`
- **Build command**: `npm run build`
- **Publish directory**: `dist`

---

## Database

- SQLite file at `backend/data/database.db`
- Path configurable via `DATA_DIR` environment variable
- WAL mode enabled for better concurrent read performance
- Key tables: `users`, `products`, `orders`, `order_items`, `consumers`, `consumer_orders`, `consumer_order_items`, `commissions`, `weekly_payouts`, `settings`, `consumer_addresses`, `consumer_otps`, `notifications`
- Notifications table stores: `user_type` (`dealer`|`admin`|`consumer`), `user_id`, `title`, `body`, `data`, `channel`, `read`, `created_at`

---

## Known Issues / Gotchas

1. **Tunnel URL changes on restart** — must update `VITE_API_URL` in Netlify and redeploy each time
2. **Backend HTTPS vs HTTP** — cloudflared must use `https://localhost:5001`, not `http://`
3. **CORS** — if adding a new frontend origin, add it to `allowedOrigins` in `backend/src/index.js` or set `FRONTEND_URL` env var
4. **Consumer auth 401 redirect** — the main `api` axios instance redirects to `/login` on 401. Consumer pages must use `consumerApi` exclusively or they'll be wrongly redirected
5. **`import.meta.env` types** — `frontend/src/vite-env.d.ts` must exist for TypeScript to compile without errors (Netlify build will fail without it)
6. **Socket reconnects** — Socket.IO context only reconnects on `storage` events (login/logout in another tab). A full page reload also forces reconnect.
