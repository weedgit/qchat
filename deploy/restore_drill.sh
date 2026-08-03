#!/usr/bin/env bash
# Timed backup → isolated restore drill (does NOT overwrite production DB).
# Targets: RPO ≤ 24h / RTO ≤ 4h
# Usage: ./deploy/restore_drill.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/deploy/backup-lib.sh"

REPORT_DIR="${QCHAT_DRILL_REPORT_DIR:-$(backup_root)/drills}"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/drill-$STAMP.md"
DRILL_DB="${QCHAT_DRILL_DB:-qchat_drill}"

log() { printf '%s\n' "$*" | tee -a "$REPORT"; }

: > "$REPORT"
log "# Qchat restore drill — $STAMP"
log ""
log "Targets: RPO ≤ 24h, RTO ≤ 4h"
log "Mode: isolated database \`$DRILL_DB\` (production \`qchat\` untouched)"
log ""

START_TOTAL="$(date +%s)"

log "## 1. Backup"
T0="$(date +%s)"
bash "$ROOT/deploy/backup.sh" | tee -a "$REPORT"
BACKUP_DIR="$(readlink -f "$(backup_root)/latest" 2>/dev/null || true)"
if [[ -z "$BACKUP_DIR" || (! -f "$BACKUP_DIR/qchat.dump" && ! -f "$BACKUP_DIR/qchat.dump.enc") ]]; then
  # Fallback: newest stamp dir
  BACKUP_DIR="$(ls -1dt "$(backup_root)"/2* 2>/dev/null | head -1 || true)"
fi
if [[ -z "$BACKUP_DIR" || (! -f "$BACKUP_DIR/qchat.dump" && ! -f "$BACKUP_DIR/qchat.dump.enc") ]]; then
  log "FAIL: no backup dump found"
  exit 1
fi
T1="$(date +%s)"
BACKUP_SECS=$((T1 - T0))
log ""
log "Backup path: \`$BACKUP_DIR\`"
log "Backup duration: ${BACKUP_SECS}s"
log ""

log "## 2. Isolated restore"
T2="$(date +%s)"
QCHAT_RESTORE_DB="$DRILL_DB" \
  QCHAT_RESTORE_MINIO=1 \
  QCHAT_RESTORE_UPLOADS=1 \
  bash "$ROOT/deploy/restore.sh" "$BACKUP_DIR" | tee -a "$REPORT"
T3="$(date +%s)"
RESTORE_SECS=$((T3 - T2))
log ""
log "Restore duration: ${RESTORE_SECS}s"
log ""

log "## 3. Verify drill DB"
ROW_USERS="$(compose exec -T postgres \
  psql -U qchat -d "$DRILL_DB" -Atc "SELECT count(*) FROM users;" 2>/dev/null | tr -d '[:space:]' || echo fail)"
log "users count in $DRILL_DB: $ROW_USERS"
if [[ "$ROW_USERS" == "fail" || -z "$ROW_USERS" ]]; then
  HEALTH=FAIL
  log "health: FAIL (could not query drill DB)"
else
  HEALTH=OK
  log "health: OK"
fi

log "## 4. Drop drill database"
compose exec -T postgres \
  psql -U qchat -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${DRILL_DB};" | tee -a "$REPORT" || true

# Optional API check (production still running; not part of isolated restore)
log ""
log "## 5. Production API health (unchanged by drill)"
if curl -fsS --retry 3 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
  log "production healthz: OK"
else
  log "production healthz: unavailable (noted; drill DB path still valid)"
fi

END_TOTAL="$(date +%s)"
TOTAL=$((END_TOTAL - START_TOTAL))
RTO_HOURS="$(awk -v s="$TOTAL" 'BEGIN { printf "%.4f", s/3600 }')"

log ""
log "## Result"
log ""
log "| Metric | Value |"
log "|---|---|"
log "| Backup seconds | $BACKUP_SECS |"
log "| Restore seconds | $RESTORE_SECS |"
log "| Total wall seconds (RTO sample) | $TOTAL (~${RTO_HOURS}h) |"
log "| Drill DB health | $HEALTH |"
log "| RPO target | ≤ 24h (daily cron) |"
log "| RTO target | ≤ 4h |"
log ""

# Refresh status.json so admin UI sees the drill
if [[ -f "$(backup_root)/latest/manifest.json" ]]; then
  LATEST="$(basename "$(readlink -f "$(backup_root)/latest")")"
  # shellcheck disable=SC1091
  ENCRYPTED=false
  grep -q '"encrypted": true' "$(backup_root)/latest/manifest.json" 2>/dev/null && ENCRYPTED=true
  write_status_json "$(backup_root)" "$LATEST" "$(backup_root)/$LATEST" "$ENCRYPTED" 0 || true
fi

if [[ "$HEALTH" != "OK" ]]; then
  log "**DRILL FAILED** — isolated restore verification failed."
  exit 1
fi
if awk -v s="$TOTAL" 'BEGIN { exit !(s > 4*3600) }'; then
  log "**DRILL WARNING** — wall clock exceeded 4h RTO target."
  exit 2
fi

log "**DRILL OK** — isolated restore completed within RTO budget."
echo ""
echo "Report written to $REPORT"
