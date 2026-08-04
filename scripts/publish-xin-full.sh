#!/usr/bin/env bash
# Full XinChat release: desktop update feed + download page sync + xin-web deploy.
#
# Usage:
#   ./scripts/publish-xin-full.sh              # sync feeds + downloads + redeploy
#   ./scripts/publish-xin-full.sh --skip-redeploy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_REDEPLOY=0

for arg in "$@"; do
  case "$arg" in
    --skip-redeploy) SKIP_REDEPLOY=1 ;;
    -h|--help)
      sed -n '1,10p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }

log "ensure host directories"
"$ROOT/deploy/setup-xin-release.sh"

log "sync desktop auto-update feed"
DEST="${DEST:-/var/www/xin-desktop-updates}" "$ROOT/scripts/sync-xin-desktop-updates.sh"

log "sync download page installers"
"$ROOT/scripts/sync-xin-installers.sh"

if [[ "$SKIP_REDEPLOY" -eq 0 ]]; then
  log "redeploy xin-web"
  "$ROOT/deploy/redeploy.sh" --xin-web --sync-xin-installers --skip-env-check
else
  log "skip redeploy"
  cd "$ROOT/apps/xin-web" && NEXT_PUBLIC_API_URL="" npm run build
  if command -v nginx >/dev/null 2>&1; then
    nginx -t && systemctl reload nginx
  fi
fi

log "smoke tests"
bash "$ROOT/deploy/smoke-xin.sh"
bash "$ROOT/deploy/smoke-xin-desktop-updates.sh"

log "publish-xin-full complete"
echo "Download: https://<host>/xin/download"
echo "Updates:  https://<host>/xin-desktop-updates/"
