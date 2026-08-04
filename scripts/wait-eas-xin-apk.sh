#!/usr/bin/env bash
# Poll EAS until preview APK finishes, download, and publish to /xin/download.
#
# Usage:
#   ./scripts/wait-eas-xin-apk.sh [profile] [max_minutes]
# Requires: EXPO_TOKEN or interactive eas login, EAS_PROJECT_ID in .env
set -euo pipefail

PROFILE="${1:-preview}"
MAX_MIN="${2:-45}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/xin-mobile"
EAS="$MOBILE/scripts/eas.sh"

cd "$MOBILE"
if [[ -f .env ]]; then set -a; source .env; set +a; fi

if ! "$EAS" whoami >/dev/null 2>&1; then
  echo "error: not logged in — EXPO_TOKEN or npm run eas:login" >&2
  exit 1
fi

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

deadline=$((SECONDS + MAX_MIN * 60))
while (( SECONDS < deadline )); do
  status="$("$EAS" build:list \
    --platform android \
    --build-profile "$PROFILE" \
    --limit 1 \
    --json \
    --non-interactive 2>/dev/null | node -e '
const fs=require("fs");
const raw=fs.readFileSync(0,"utf8").trim();
if(!raw) process.exit(2);
const row=(JSON.parse(raw)[0]||{});
process.stdout.write(row.status||"unknown");
' || echo unknown)"

  log "latest build status: $status"
  case "$status" in
    finished)
      cd "$ROOT" && "$ROOT/scripts/eas-pull-xin-apk.sh" "$PROFILE"
      "$ROOT/scripts/publish-xin-release.sh" --skip-dist
      log "done"
      exit 0
      ;;
    errored|canceled)
      echo "error: build $status" >&2
      exit 1
      ;;
  esac
  sleep 30
done

echo "error: timed out after ${MAX_MIN}m" >&2
exit 1
