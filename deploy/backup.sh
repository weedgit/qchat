#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${QCHAT_BACKUP_DIR:-$ROOT/backups}/$STAMP"
mkdir -p "$OUT"

echo "Backing up Postgres..."
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  pg_dump -U qchat -d qchat --format=custom > "$OUT/qchat.dump"

echo "Backing up local uploads..."
if [[ -d "$ROOT/services/api/data/uploads" ]]; then
  tar -C "$ROOT/services/api/data" -czf "$OUT/uploads.tar.gz" uploads
fi

echo "Writing manifest..."
cat > "$OUT/manifest.json" <<EOF
{"created_at":"$STAMP","rpo_hours":24,"components":["postgres","uploads"]}
EOF

echo "Backup complete: $OUT"
