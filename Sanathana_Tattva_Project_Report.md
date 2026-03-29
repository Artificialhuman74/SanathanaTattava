# Sanathana Tattva — Project Report
**Prepared for:** Development Team
**Date:** March 2026
**Status:** Active Development — MVP In Progress

---

## 1. What Is This App?

**Sanathana Tattva** is a full-stack B2C2B (Business-to-Consumer-to-Business) distribution and trading platform. It manages a supply chain between a central admin, a two-tier network of traders/dealers, consumers, and delivery partners.

**Live URL:** https://sanathanatattva.shop
**GitHub Repo:** https://github.com/Artificialhuman74/SanathanaTattva

The platform allows:
- Consumers to shop for products and get them delivered
- Dealers to earn commissions by referring and serving consumers
- A parent-dealer / sub-dealer hierarchy with commission splitting
- Admins to manage the entire supply chain from a single dashboard

---

## 2. The Goal

Build a distribution network where:

1. **Admin** manages products, stock, pricing, and commissions from a central warehouse
2. **Tier 1 Dealers (Parent Dealers)** onboard sub-dealers and consumers, earn commissions on all orders in their network
3. **Tier 2 Dealers (Sub-Dealers)** refer consumers and fulfill deliveries, earn commissions on their consumers' orders
4. **Consumers** shop, get deliveries at their door, and optionally get discounts through dealer referral codes
5. **Delivery Partners** (who are also dealers) accept, pack, and deliver orders with OTP verification

---

## 3. User Roles

| Role | Who They Are | What They Do |
|------|-------------|--------------|
| **Admin** | Platform owner/operator | Manages products, inventory, traders, commissions, orders, settings |
| **Tier 1 Dealer** | Parent dealer | Onboards sub-dealers, serves consumers, earns commissions from their entire network |
| **Tier 2 Dealer** | Sub-dealer under a Tier 1 | Refers consumers, fulfills deliveries, earns direct commissions |
| **Consumer** | End customer | Shops, places orders, gets delivery to their door |
| **Delivery Partner** | Any delivery-enabled dealer | Accepts delivery assignments, runs OTP-verified delivery flow |

---

## 4. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | React 18 + TypeScript + Vite | Fast, typed, component-based UI |
| **Styling** | Tailwind CSS | Utility-first, consistent design |
| **Backend** | Node.js + Express | Lightweight REST API |
| **Database** | SQLite (better-sqlite3) | Simple, file-based, no separate DB server needed |
| **Real-time** | Socket.IO (WebSockets) | Live notifications, order status updates |
| **Auth** | JWT tokens | Stateless, role-based auth |
| **Geolocation** | H3 (Uber's hexagonal grid) + Nominatim | Nearest-dealer delivery assignment |
| **Frontend Host** | Netlify | Auto-deploy from GitHub, free SSL, CDN |
| **Backend Host** | Developer's laptop (cloudflared tunnel) | Current dev/demo setup |
| **Domain** | GoDaddy → sanathanatattva.shop | Live domain, DNS → Netlify |

---

## 5. What Is Already Built

### 5.1 Authentication
- [x] Trader/Admin login — email + password (JWT)
- [x] Trader registration with referral code (auto-assigns Tier 1 or Tier 2)
- [x] Consumer login — OTP-based via email (no password)
- [x] Consumer registration (phone + optional email)
- [x] Referral code validation at registration

### 5.2 Admin Panel
- [x] Dashboard — platform-wide stats (traders, consumers, revenue, orders, commissions)
- [x] Product management — create, edit, delete, stock tracking
- [x] Trader management — view by tier, suspend/activate, set commission rates, toggle delivery
- [x] Consumer management — search, filter by referral, view order history
- [x] B2B order management — confirm and track wholesale orders from traders
- [x] Consumer order management — assign delivery dealers, update status, view commissions
- [x] Inventory overview — warehouse + all dealer stock levels, low-stock alerts
- [x] Inventory restocking — admin allocates stock from warehouse to specific dealer
- [x] Transaction log — full inventory movement history
- [x] Commission management — view, process weekly batches, mark payouts
- [x] Platform settings — referral discount percentage (0–100%)

### 5.3 Trader / Dealer Panel
- [x] Dashboard — personal stats (orders, commissions, linked consumers)
- [x] Product catalogue — browse available products
- [x] Personal inventory — current stock levels per product
- [x] B2B ordering — place wholesale orders from admin warehouse
- [x] Consumer orders — view orders from linked consumers, update delivery status
- [x] Commission tracking — view earnings, weekly breakdowns, payout history
- [x] Sub-dealer management (Tier 1 only) — view sub-dealers, set their commission rates, toggle delivery
- [x] Profile management — update personal info, view referral code, tier info
- [x] Referral page — referral code display, instructions

### 5.4 Consumer Panel
- [x] Product shop — browse, search by name/category
- [x] Shopping cart — add/remove, quantity adjustment, referral discount shown
- [x] Checkout — choose/create delivery address, referral code entry, discount calculation
- [x] Address management — multiple saved addresses, default address, GPS geocoding
- [x] Order history — list, status tracking
- [x] Real-time delivery tracking via notifications

### 5.5 Delivery Partner Panel
- [x] Dashboard — assigned orders, today's stats, online/offline toggle
- [x] Order list — filter by delivery status
- [x] Delivery workflow — accept → pack → start delivery → verify OTP → delivered
- [x] Delivery OTP — generated on "start delivery", sent to consumer, 30 min validity, max 5 attempts
- [x] Failed delivery reporting with reason
- [x] Delivery history and stats
- [x] Location/availability management

### 5.6 Notification System
- [x] In-app notification bell for all roles (dealer, admin, consumer)
- [x] Real-time delivery via WebSocket
- [x] Sound notifications (two-tone chime via Web Audio API)
- [x] Browser push notifications (OS-level, works when tab is in background)
- [x] Sound on/off toggle (persisted)
- [x] Mark as read / mark all read
- [x] Bell animation on new notification

### 5.7 Delivery & Location System
- [x] H3 geospatial indexing for traders and delivery addresses
- [x] Auto-geocoding (GPS priority, Nominatim/OpenStreetMap fallback)
- [x] Nearest-dealer assignment at checkout
- [x] Fallback: linked dealer → parent dealer → admin (if no nearby dealer found)
- [x] Delivery OTP verification flow
- [x] Consumer real-time notifications through delivery lifecycle

### 5.8 Commission System
- [x] Auto-generated on consumer order placement
- [x] Direct commission for linked dealer
- [x] Override commission for parent dealer (if consumer linked through sub-dealer)
- [x] Configurable commission rates per dealer
- [x] Weekly commission batching and payout processing
- [x] Full payout history

---

## 6. What Still Needs To Be Done

### 6.1 High Priority (Core Functionality Gaps)

| # | Feature | Details |
|---|---------|---------|
| 1 | **Real email/OTP delivery** | Currently OTP is shown on screen in dev mode. Need to integrate a real email provider (Resend, SendGrid, or Nodemailer with SMTP) for consumer login |
| 2 | **Payment gateway integration** | No payment processing exists. Orders are placed but not paid for. Need Razorpay / Stripe / UPI integration |
| 3 | **Backend production hosting** | Backend currently runs on developer's laptop via cloudflared tunnel. Needs a proper server (Railway, Render, DigitalOcean, or VPS) |
| 4 | **Persistent database** | SQLite on laptop means data is lost if laptop is off or crashes. Need either a hosted server with persistent disk or migrate to PostgreSQL |

### 6.2 Medium Priority (UX & Completeness)

| # | Feature | Details |
|---|---------|---------|
| 5 | **Consumer order cancellation** | Consumers have no way to cancel an order from their side |
| 6 | **Product images** | Products have an `image_url` field but no image upload UI. Admin needs image upload or URL input |
| 7 | **SMS OTP fallback** | Email OTP assumes consumer has an email. SMS OTP (Twilio / MSG91) is more reliable for mobile-first consumers |
| 8 | **Push notification service worker** | Current browser push notifications only work while the tab is open. A full service worker would push even when browser is closed |
| 9 | **Admin delivery assignment UI** | Admin can assign delivery dealers to direct orders (no referral) but the UI needs refinement |
| 10 | **Referral discount visibility** | Consumers only see the discount at checkout. Should be shown on product pages too |
| 11 | **Trader B2B order approval flow** | Admin confirms B2B orders manually. No notifications sent to trader when status changes |
| 12 | **Consumer order invoice/receipt** | No PDF invoice generation after successful order |

### 6.3 Low Priority (Enhancements)

| # | Feature | Details |
|---|---------|---------|
| 13 | **Mobile app** | Currently a web app (mobile-responsive). A React Native app would improve consumer UX |
| 14 | **Delivery partner GPS tracking** | Real-time location sharing during delivery (Google Maps integration) |
| 15 | **Product reviews/ratings** | Consumers cannot review products |
| 16 | **Inventory auto-reorder alerts** | Admin gets low stock alerts but no auto-reorder workflow |
| 17 | **Analytics dashboard** | Charts for revenue trends, order volume, top products, top dealers |
| 18 | **WhatsApp notifications** | Many Indian consumers prefer WhatsApp over email |
| 19 | **Bulk order import** | Admin currently adds products one-by-one; need CSV import |
| 20 | **Multi-language support** | Currently English only |

---

## 7. Data Flow — How An Order Works End to End

```
Consumer → Checkout
      │
      ├─ Has referral code?
      │     Yes → Linked to that dealer → Gets discount
      │     No  → Direct order (admin handles)
      │
      ├─ System geocodes delivery address (GPS or Nominatim)
      │
      ├─ H3 spatial search → finds nearest delivery-enabled dealer
      │     No nearby dealer? → Falls back to linked dealer → falls back to admin
      │
      ├─ Creates consumer_order
      ├─ Creates commission records (linked dealer + parent if sub-dealer)
      ├─ Notifies delivery dealer
      │
      └─ Order status: PENDING
            │
            Delivery dealer accepts → ACCEPTED
            Delivery dealer packs → PACKED (triggers inventory deduction)
            Delivery partner picks up → OUT FOR DELIVERY (OTP generated, sent to consumer)
            Consumer provides OTP → DELIVERED (commission status updated)
            Cannot deliver → FAILED (reason recorded)
```

---

## 8. Commission Flow

```
Consumer places order (₹1000)
      │
      ├─ Linked dealer commission rate = 10%
      │     → Commission: ₹100 (status: PENDING)
      │
      ├─ Is linked dealer a Tier 2 sub-dealer?
      │     Yes → Parent dealer gets override commission too
      │           Parent rate = 5% → Commission: ₹50 (status: PENDING)
      │
Every week, Admin goes to Commissions page:
      │
      ├─ Reviews pending commissions per dealer
      ├─ Clicks "Process Week" → Groups into weekly_payouts
      └─ Marks payout PROCESSED (paid externally)
```

---

## 9. Deployment Architecture (Current)

```
Consumer/Trader Browser
         │
         ▼
    Netlify CDN
  sanathanatattva.shop
  (React SPA — static)
         │ API calls via VITE_API_URL
         ▼
  cloudflared tunnel
  (temporary public HTTPS URL)
         │
         ▼
  Developer's Laptop
  Node.js + Express
  (https://localhost:5001)
         │
         ▼
  SQLite Database
  (backend/data/database.db)
```

**Problem with this setup:** The cloudflared tunnel URL changes every restart. Every restart requires updating the env var in Netlify and redeploying the frontend.

**Recommended Production Setup:**
```
Browser
  │
  ▼
Netlify (frontend) ──── Railway / Render (backend, always-on)
                                  │
                              PostgreSQL
                         (managed cloud database)
```

---

## 10. Environment Variables

### Frontend (Netlify)

| Variable | Current Value | Notes |
|----------|--------------|-------|
| `VITE_API_URL` | `https://xxxx.trycloudflare.com` | Must update when tunnel restarts |

### Backend (.env on server)

| Variable | Required | Notes |
|----------|----------|-------|
| `JWT_SECRET` | Yes | Secret key for JWT signing |
| `PORT` | No | Default: 5001 |
| `DATA_DIR` | No | Path to SQLite data folder |
| `FRONTEND_URL` | No | Extra CORS origin (optional) |

---

## 11. Key Technical Decisions Made

| Decision | What Was Chosen | Why |
|----------|----------------|-----|
| Database | SQLite | Simple, no infra, good for early stage |
| Auth (consumers) | OTP via email | No password friction for mobile users |
| Auth (traders) | JWT + email/password | Standard, easy to implement |
| Location | H3 hexagonal grid | Industry standard for spatial delivery assignment |
| Real-time | Socket.IO | Handles WebSocket + polling fallback automatically |
| Notifications | Web Audio API | No audio files needed; synthesized in-browser |
| Frontend hosting | Netlify | Auto-deploy from GitHub, free SSL, no config |
| CORS | Explicit allow-list | Prevents unauthorized API access |

---

## 12. Known Issues / Bugs

| Issue | Impact | Fix |
|-------|--------|-----|
| cloudflared tunnel URL changes on restart | Frontend breaks, users can't reach backend | Move backend to permanent hosting |
| OTP emails not actually sent (dev mode) | Consumer login doesn't work in production | Integrate real email provider |
| No payment gateway | Orders placed without payment | Integrate Razorpay or Stripe |
| SQLite on laptop = data loss risk | All data gone if laptop fails | Move to persistent hosted database |
| Backend needs laptop to be on | Downtime whenever laptop sleeps | Move to always-on server |

---

## 13. How To Run Locally (For Developers)

### Prerequisites
- Node.js 18+
- Git

### Setup

```bash
git clone https://github.com/Artificialhuman74/SanathanaTattva.git
cd SanathanaTattva

# Backend
cd backend
npm install
cp .env.example .env   # fill in JWT_SECRET
npm run dev            # runs on https://localhost:5001

# Frontend (new terminal)
cd frontend
npm install
npm run dev            # runs on http://localhost:3000
```

### Seed the database (first time)

```bash
cd backend
npm run seed
```

### Access the app

| URL | Role |
|-----|------|
| http://localhost:3000 | Landing page |
| http://localhost:3000/login | Trader/Admin login |
| http://localhost:3000/shop | Consumer shop |
| http://localhost:3000/admin/dashboard | Admin panel |

---

## 14. Immediate Next Steps (In Priority Order)

1. **Move backend to a real server** (Railway or Render — $5–10/month) so the site is always online
2. **Integrate email provider** (Resend is free for 3,000 emails/month) for OTP delivery
3. **Integrate payment gateway** (Razorpay — widely used in India, UPI support)
4. **Add service worker** for true background push notifications
5. **Product image uploads** (Cloudinary free tier — 25GB storage)

---

*This document reflects the state of the project as of March 2026.*
