#!/usr/bin/env bash
# Pull latest changes, then rebuild and restart Qchat.
#
# Usage:
#   ./deploy/redeploy.sh         # pull + rebuild API and web
#   ./deploy/redeploy.sh --api   # pull + API only
#   ./deploy/redeploy.sh --web   # pull + web only
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DO_API=0
DO_WEB=0
ANY_TARGET=0

usage() {
  cat <<'EOF'
Pull latest changes, then rebuild and restart Qchat.

Usage:
  ./deploy/redeploy.sh         # pull + rebuild API and web
  ./deploy/redeploy.sh --api   # pull + API only
  ./deploy/redeploy.sh --web   # pull + web only
EOF
  exit "${1:-0}"
}

for arg in "$@"; do
  case "$arg" in
    --api) DO_API=1; ANY_TARGET=1 ;;
    --web) DO_WEB=1; ANY_TARGET=1 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $arg" >&2; usage 1 ;;
  esac
done

# Default: both API and web when no target flag is given.
if [[ "$ANY_TARGET" -eq 0 ]]; then
  DO_API=1
  DO_WEB=1
fi

if [[ -x /usr/local/go/bin/go ]]; then
  export PATH="/usr/local/go/bin:$PATH"
fi

GO_BIN="$(command -v go || true)"
if [[ "$DO_API" -eq 1 && -z "$GO_BIN" ]]; then
  echo "error: go not found (install Go or add it to PATH)" >&2
  exit 1
fi

log() { printf '\n==> %s\n' "$*"; }

log "git pull"
git -C "$ROOT" pull --ff-only

if [[ "$DO_API" -eq 1 ]]; then
  log "build API"
  mkdir -p "$ROOT/services/api/bin"
  (
    cd "$ROOT/services/api"
    go build -o bin/qchat-api ./cmd/api
  )

  log "restart qchat-api"
  if systemctl is-enabled qchat-api >/dev/null 2>&1 || systemctl cat qchat-api >/dev/null 2>&1; then
    systemctl restart qchat-api
  else
    echo "warning: qchat-api.service not installed; binary rebuilt at services/api/bin/qchat-api" >&2
    echo "         install with: ln -sfn $ROOT/deploy/qchat-api.service /etc/systemd/system/qchat-api.service && systemctl daemon-reload && systemctl enable --now qchat-api" >&2
  fi
fi

if [[ "$DO_WEB" -eq 1 ]]; then
  log "build web (static export)"
  (
    cd "$ROOT/apps/web"
    if [[ ! -d node_modules ]]; then
      npm ci
    fi
    NEXT_PUBLIC_API_URL="" npm run build
  )

  # Optional: sync to a published docroot (set QCHAT_WEB_ROOT=/var/www/qchat).
  if [[ -n "${QCHAT_WEB_ROOT:-}" ]]; then
    log "sync web to $QCHAT_WEB_ROOT"
    mkdir -p "$QCHAT_WEB_ROOT"
    rsync -a --delete "$ROOT/apps/web/out/" "$QCHAT_WEB_ROOT/"
  fi

  log "reload nginx"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t
    systemctl reload nginx
  else
    echo "warning: nginx not found; static files are in apps/web/out/" >&2
  fi
fi

log "health checks"
if [[ "$DO_API" -eq 1 ]]; then
  curl -fsS --retry 5 --retry-delay 1 --retry-connrefused \
    http://127.0.0.1:8080/healthz >/dev/null
  echo "API  :8080/healthz OK"
fi

if command -v nginx >/dev/null 2>&1; then
  curl -fsS --retry 3 --retry-delay 1 -o /dev/null http://127.0.0.1/
  echo "Web  :80/ OK"
  curl -fsS --retry 3 --retry-delay 1 http://127.0.0.1/healthz >/dev/null
  echo "Nginx /healthz OK"
fi

log "redeploy complete"
