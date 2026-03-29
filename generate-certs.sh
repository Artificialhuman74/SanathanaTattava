#!/bin/bash
# ─── TradeHub SSL Certificate Generator ───────────────────────────────────
set -e

CERTS_DIR="backend/certs"
mkdir -p "$CERTS_DIR"

# Detect local IP
LOCAL_IP=""
if command -v ipconfig &>/dev/null; then
  LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
fi
if [ -z "$LOCAL_IP" ] && command -v hostname &>/dev/null; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
fi
[ -z "$LOCAL_IP" ] && LOCAL_IP="192.168.1.1"

echo ""
echo "🔐 Generating SSL certificates..."
echo "   Local IP: $LOCAL_IP"
echo ""

# Write SAN config
cat > "$CERTS_DIR/san.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions    = v3_req
prompt             = no

[req_distinguished_name]
C  = US
ST = State
L  = City
O  = TradeHub
CN = localhost

[v3_req]
subjectAltName = @alt_names
keyUsage       = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1  = 127.0.0.1
IP.2  = $LOCAL_IP
EOF

openssl req -x509 \
  -newkey rsa:4096 \
  -keyout "$CERTS_DIR/key.pem" \
  -out    "$CERTS_DIR/cert.pem" \
  -days   365 \
  -nodes \
  -config "$CERTS_DIR/san.cnf"

rm -f "$CERTS_DIR/san.cnf"

echo "✅ Certificates generated in $CERTS_DIR/"
echo ""
echo "─── Phone Access Setup ────────────────────────────────────"
echo "  1. Connect your phone to the SAME WiFi network"
echo "  2. Open browser on phone: https://$LOCAL_IP:5001"
echo "  3. Accept the security warning (tap Advanced → Proceed)"
echo "     OR install the cert: backend/certs/cert.pem"
echo "──────────────────────────────────────────────────────────"
echo ""
