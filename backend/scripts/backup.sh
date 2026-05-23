#!/usr/bin/env bash
# Usage: bash scripts/backup.sh [/path/to/database.db] [/path/to/backup/dir]
# Creates a timestamped copy of the SQLite database using the online backup API (sqlite3 .backup)
set -euo pipefail
DB="${1:-$(dirname "$0")/../data/database.db}"
BACKUP_DIR="${2:-$(dirname "$0")/../data/backups}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/database_$TIMESTAMP.db"
sqlite3 "$DB" ".backup '$DEST'"
echo "[backup] Saved to $DEST ($(du -sh "$DEST" | cut -f1))"
