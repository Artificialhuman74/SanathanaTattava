# TradeHub — Professional Trading Platform

A full-stack, HTTPS-enabled trading platform with admin panel, two-tier trader network, inventory management, and order tracking.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Recharts
- **Backend**:  Node.js + Express + SQLite (better-sqlite3) + JWT
- **SSL**:      Self-signed certificate (works on phone via local network)

## Quick Start

```bash
chmod +x setup.sh
./setup.sh
cd backend && npm start
```

Open **https://localhost:5001** in your browser.

## Development Mode (hot reload)

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open **https://localhost:3000** for frontend with hot reload.

## Demo Credentials

| Role          | Email                    | Password    |
|---------------|--------------------------|-------------|
| Admin         | admin@tradehub.com       | Admin@123   |
| Tier 1 Trader | alex@tradehub.com        | Trader@123  |
| Tier 1 Trader | maria@tradehub.com       | Trader@123  |
| Tier 2 Trader | sarah@tradehub.com       | Trader@123  |

## Features

### Admin
- Dashboard with revenue charts and stats
- Inventory CRUD (add/edit/archive products)
- Trader management (activate/suspend, view hierarchy)
- Order management (update statuses)

### Tier 1 Trader
- Browse and order products
- Unique referral code auto-generated
- Referral dashboard (view sub-traders)
- Order history with tracking

### Tier 2 Sub-Trader
- Register using a Tier 1 trader's referral code
- Browse and order products
- Order history

## Phone Access (HTTPS on local network)

1. Connect phone to the **same WiFi** network as your computer
2. Find your computer's local IP (shown in terminal on startup)
3. Open `https://<your-ip>:5001` on your phone
4. Accept the SSL warning (tap **Advanced** → **Proceed**)

To avoid the SSL warning, install `backend/certs/cert.pem` on your phone.

## Re-seed Database

```bash
cd backend && npm run seed
```
