#!/bin/bash
# ─── TradeHub Complete Setup Script ───────────────────────────────────────
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo ""
echo -e "${BLUE}╔═══════════════════════════════════╗${NC}"
echo -e "${BLUE}║        TradeHub Setup             ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════╝${NC}"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Please install Node.js 18+ from https://nodejs.org${NC}"
  exit 1
fi
NODE_VER=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VER}${NC}"

# ─── Backend ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Installing backend dependencies...${NC}"
cd backend && npm install --legacy-peer-deps
echo -e "${GREEN}✓ Backend dependencies installed${NC}"
cd ..

# ─── SSL Certs ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Generating SSL certificates...${NC}"
chmod +x generate-certs.sh
./generate-certs.sh

# ─── Seed Database ──────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Seeding database with demo data...${NC}"
cd backend && node src/database/seed.js
cd ..

# ─── Frontend ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Installing frontend dependencies...${NC}"
cd frontend && npm install --legacy-peer-deps
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

echo ""
echo -e "${BLUE}▸ Building frontend...${NC}"
npm run build
echo -e "${GREEN}✓ Frontend built successfully${NC}"
cd ..

# ─── Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Setup Complete! 🚀               ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}To start the server:${NC}"
echo "  cd backend && npm start"
echo ""
echo -e "${YELLOW}Or run frontend + backend separately for development:${NC}"
echo "  Terminal 1:  cd backend  && npm run dev"
echo "  Terminal 2:  cd frontend && npm run dev"
echo ""
echo -e "${YELLOW}Credentials:${NC}"
echo "  Admin:    admin@tradehub.com   / Admin@123"
echo "  Tier 1:   alex@tradehub.com   / Trader@123"
echo "  Tier 2:   sarah@tradehub.com  / Trader@123"
echo ""
