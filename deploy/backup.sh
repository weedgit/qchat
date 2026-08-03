#!/usr/bin/env bash
# Qchat customized backup — Postgres + MinIO + local uploads (+ optional secrets).
# Targets: RPO ≤ 24h (cron), off-site + encryption for server failure.
#
# Env:
#   QCHAT_BACKUP_DIR, QCHAT_BACKUP_PASSPHRASE[_FILE], QCHAT_BACKUP_OFFSITE
#   QCHAT_BACKUP_KEEP_DAYS (default 14), QCHAT_BACKUP_INCLUDE_SECRETS=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/deploy/backup-lib.sh"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT="$(backup_root)"
OUT="$BACKUP_ROOT/$STAMP"
mkdir -p "$OUT"

echo "==> Backup $STAMP → $OUT"

COMPONENTS=()
ERRORS=0

echo "Backing up Postgres..."
if compose exec -T postgres \
  pg_dump -U qchat -d qchat --format=custom > "$OUT/qchat.dump"; then
  COMPONENTS+=("postgres")
  echo "  ok: qchat.dump ($(wc -c < "$OUT/qchat.dump") bytes)"
else
  echo "  FAIL: pg_dump" >&2
  ERRORS=$((ERRORS + 1))
fi

echo "Backing up MinIO object storage..."
MINIO_VOL="$(minio_volume_name)"
if [[ -n "$MINIO_VOL" ]] && docker volume inspect "$MINIO_VOL" >/dev/null 2>&1; then
  if docker run --rm \
    -v "${MINIO_VOL}:/data:ro" \
    -v "$OUT:/backup" \
    alpine:3.20 \
    tar czf /backup/minio.tar.gz -C /data .; then
    COMPONENTS+=("minio")
    echo "  ok: minio.tar.gz from $MINIO_VOL ($(wc -c < "$OUT/minio.tar.gz") bytes)"
  else
    echo "  FAIL: minio tar" >&2
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  skip: MinIO volume not found (${MINIO_VOL:-unknown})"
fi

echo "Backing up local uploads..."
UPLOADS_SRC="${QCHAT_DATA_DIR:-$ROOT/services/api/data}/uploads"
if [[ -d "$UPLOADS_SRC" ]]; then
  tar -C "$(dirname "$UPLOADS_SRC")" -czf "$OUT/uploads.tar.gz" "$(basename "$UPLOADS_SRC")"
  COMPONENTS+=("uploads")
  echo "  ok: uploads.tar.gz"
else
  echo "  skip: no local uploads dir"
fi

if [[ "${QCHAT_BACKUP_INCLUDE_SECRETS:-0}" == "1" ]]; then
  echo "Packing secrets bundle (env + certs)..."
  SECRETS_TMP="$(mktemp -d)"
  mkdir -p "$SECRETS_TMP/secrets"
  [[ -f "$ROOT/deploy/qchat-api.env" ]] && cp -a "$ROOT/deploy/qchat-api.env" "$SECRETS_TMP/secrets/"
  [[ -d "$ROOT/deploy/certs" ]] && cp -a "$ROOT/deploy/certs" "$SECRETS_TMP/secrets/"
  printf '%s\n' "Restore with QCHAT_RESTORE_SECRETS=1. Keep deploy/backup.passphrase off-host." \
    > "$SECRETS_TMP/secrets/README.txt"
  tar -C "$SECRETS_TMP" -czf "$OUT/secrets.tar.gz" secrets
  rm -rf "$SECRETS_TMP"
  COMPONENTS+=("secrets")
  echo "  ok: secrets.tar.gz"
fi

ENCRYPTED=false
if passphrase_available; then
  echo "Encrypting artifacts (AES-256-CBC)..."
  for f in qchat.dump minio.tar.gz uploads.tar.gz secrets.tar.gz; do
    if [[ -f "$OUT/$f" ]]; then
      encrypt_file "$OUT/$f" "$OUT/$f.enc"
      shred_or_rm "$OUT/$f"
      ENCRYPTED=true
    fi
  done
  COMPONENTS+=("encrypted")
  echo "  ok: *.enc"
else
  echo "  WARN: no passphrase — plaintext dumps. Run ./deploy/backup-init-passphrase.sh"
fi

python3 - "$OUT/manifest.json" "$STAMP" "$ENCRYPTED" "$ERRORS" "${COMPONENTS[@]}" <<'PY'
import json, sys, socket
path, stamp, enc, errors = sys.argv[1], sys.argv[2], sys.argv[3] == "True", int(sys.argv[4])
comps = sys.argv[5:]
data = {
  "created_at": stamp,
  "rpo_hours": 24,
  "rto_hours": 4,
  "components": comps,
  "encrypted": enc,
  "errors": errors,
  "host": socket.gethostname(),
}
with open(path, "w") as f:
  json.dump(data, f, indent=2)
  f.write("\n")
PY

ln -sfn "$STAMP" "$BACKUP_ROOT/latest"
write_status_json "$BACKUP_ROOT" "$STAMP" "$OUT" "$ENCRYPTED" "$ERRORS" "${COMPONENTS[@]}"

OFFSITE="${QCHAT_BACKUP_OFFSITE:-}"
if [[ -n "$OFFSITE" ]]; then
  echo "Off-site sync → $OFFSITE"
  mkdir -p "$OFFSITE" 2>/dev/null || true
  if rsync -a "$OUT/" "$OFFSITE/$STAMP/"; then
    rsync -a "$BACKUP_ROOT/status.json" "$OFFSITE/status.json" 2>/dev/null || true
    echo "  ok: rsync"
  else
    echo "  FAIL: rsync to offsite" >&2
    ERRORS=$((ERRORS + 1))
    write_status_json "$BACKUP_ROOT" "$STAMP" "$OUT" "$ENCRYPTED" "$ERRORS" "${COMPONENTS[@]}"
  fi
else
  echo "  WARN: QCHAT_BACKUP_OFFSITE unset — not resilient to total host loss"
fi

KEEP_DAYS="${QCHAT_BACKUP_KEEP_DAYS:-14}"
echo "Pruning local backups older than ${KEEP_DAYS} days..."
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '2*' -mtime "+${KEEP_DAYS}" -print -exec rm -rf {} + 2>/dev/null || true

if [[ "$ERRORS" -gt 0 ]]; then
  echo "Backup finished with $ERRORS error(s): $OUT" >&2
  exit 1
fi
echo "Backup complete: $OUT"
