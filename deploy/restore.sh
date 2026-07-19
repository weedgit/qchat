#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?usage: restore.sh /path/to/backup-dir}"

echo "Restoring Postgres from $SRC/qchat.dump"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  pg_restore -U qchat -d qchat --clean --if-exists < "$SRC/qchat.dump" || true

if [[ -f "$SRC/uploads.tar.gz" ]]; then
  mkdir -p "$ROOT/services/api/data"
  tar -C "$ROOT/services/api/data" -xzf "$SRC/uploads.tar.gz"
fi

echo "Restore complete. Validate with curl http://localhost:8080/healthz"
