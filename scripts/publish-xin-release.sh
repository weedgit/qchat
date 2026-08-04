#!/usr/bin/env bash
# Sync XinChat desktop/mobile installers and redeploy xin-web.
#
# Usage:
#   ./scripts/publish-xin-release.sh              # sync + redeploy
#   ./scripts/publish-xin-release.sh --linux-dist # build Linux desktop first
#   ./scripts/publish-xin-release.sh --skip-dist --skip-redeploy  # sync only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LINUX_DIST=0
SKIP_DIST=0
SKIP_REDEPLOY=0

for arg in "$@"; do
  case "$arg" in
    --linux-dist) LINUX_DIST=1 ;;
    --skip-dist) SKIP_DIST=1 ;;
    --skip-redeploy) SKIP_REDEPLOY=1 ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }

if [[ "$SKIP_DIST" -eq 0 && "$LINUX_DIST" -eq 1 ]]; then
  log "build XinChat desktop (Linux AppImage)"
  (
    cd "$ROOT/apps/xin-desktop"
    npm ci
    npm run check
    npm run dist:linux
  )
fi

log "sync installers into apps/xin-web/public/downloads"
"$ROOT/scripts/sync-xin-installers.sh"

if [[ "$SKIP_REDEPLOY" -eq 0 ]]; then
  log "redeploy xin-web"
  "$ROOT/deploy/redeploy.sh" --xin-web --sync-xin-installers --skip-env-check
else
  log "skip redeploy (--skip-redeploy)"
fi

log "publish complete"
echo "Download page: https://<host>/xin/download"
