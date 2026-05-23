#!/usr/bin/env bash
# Usage: bash scripts/restore-drill.sh /path/to/backup.db
# Copies the backup to a temp dir, starts the server against it, and hits /api/health
set -euo pipefail
BACKUP="${1:?Usage: restore-drill.sh /path/to/backup.db}"
TMPDIR=$(mktemp -d)
cp "$BACKUP" "$TMPDIR/database.db"
echo "[restore] Copied backup to $TMPDIR/database.db"
DATA_DIR="$TMPDIR" PORT=5099 node "$(dirname "$0")/../src/index.js" &
SERVER_PID=$!
sleep 3
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5099/api/health)
kill $SERVER_PID 2>/dev/null || true
if [ "$STATUS" = "200" ]; then echo "[restore] Drill passed — server booted OK"; else echo "[restore] FAILED — /api/health returned $STATUS"; exit 1; fi
rm -rf "$TMPDIR"
