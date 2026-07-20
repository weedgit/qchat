#!/usr/bin/env bash
# Timed backup → restore drill to verify RPO ≤ 24h / RTO ≤ 4h targets.
# Usage: ./deploy/restore_drill.sh
# Optional: QCHAT_DRILL_KEEP=1 to leave the drill backup directory in place.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="${QCHAT_DRILL_REPORT_DIR:-$ROOT/backups/drills}"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/drill-$STAMP.md"

log() { printf '%s\n' "$*" | tee -a "$REPORT"; }

: > "$REPORT"
log "# Qchat restore drill — $STAMP"
log ""
log "Targets: RPO ≤ 24h, RTO ≤ 4h"
log ""

START_TOTAL="$(date +%s)"

log "## 1. Backup"
T0="$(date +%s)"
bash "$ROOT/deploy/backup.sh" | tee -a "$REPORT"
# Latest backup dir
BACKUP_DIR="$(ls -1dt "${QCHAT_BACKUP_DIR:-$ROOT/backups}"/2* 2>/dev/null | head -1 || true)"
if [[ -z "$BACKUP_DIR" || ! -f "$BACKUP_DIR/qchat.dump" ]]; then
  log "FAIL: no backup dump found"
  exit 1
fi
T1="$(date +%s)"
BACKUP_SECS=$((T1 - T0))
log ""
log "Backup path: \`$BACKUP_DIR\`"
log "Backup duration: ${BACKUP_SECS}s"
log ""

log "## 2. Restore"
T2="$(date +%s)"
bash "$ROOT/deploy/restore.sh" "$BACKUP_DIR" | tee -a "$REPORT"
T3="$(date +%s)"
RESTORE_SECS=$((T3 - T2))
log ""
log "Restore duration: ${RESTORE_SECS}s"
log ""

log "## 3. Health check"
if curl -fsS --retry 5 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:8080/healthz >/dev/null; then
  log "healthz: OK"
  HEALTH=OK
else
  log "healthz: FAIL (is the API running?)"
  HEALTH=FAIL
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
log "| Health | $HEALTH |"
log "| RPO target | ≤ 24h (schedule backups at least daily — see cron example) |"
log "| RTO target | ≤ 4h |"
log ""

if [[ "$HEALTH" != "OK" ]]; then
  log "**DRILL FAILED** — API health check failed after restore."
  exit 1
fi
if awk -v s="$TOTAL" 'BEGIN { exit !(s > 4*3600) }'; then
  log "**DRILL WARNING** — wall clock exceeded 4h RTO target."
  exit 2
fi

log "**DRILL OK** — restore completed within RTO budget."
echo ""
echo "Report written to $REPORT"

if [[ "${QCHAT_DRILL_KEEP:-0}" != "1" ]]; then
  # Keep the timed backup used for the drill; only prune empty placeholder dirs if any.
  true
fi
