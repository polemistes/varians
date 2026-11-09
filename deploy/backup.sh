#!/usr/bin/env bash
# Dump the database and copy the storage directory into /home/varians/backups/<date>,
# keeping two weeks. Run as the varians user (the varians-backup timer does it nightly).
set -euo pipefail

BASE="${VARIANS_BASE:-/home/varians}"
set -a
# shellcheck disable=SC1091
source "$BASE/varians.env"
set +a

DEST="$BASE/backups/$(date +%Y-%m-%d)"
mkdir -p "$DEST"

pg_dump "$DATABASE_URL" --no-owner --format=custom --file="$DEST/varians.dump"
rsync -a --delete "${STORAGE_DIR%/}/" "$DEST/storage/"

# Keep the last 14 days.
find "$BASE/backups" -maxdepth 1 -mindepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "Backup written to $DEST"
