#!/usr/bin/env bash
# Pull latest changes, then rebuild and restart Qchat.
#
# Usage:
#   ./deploy/redeploy.sh                # pull + rebuild API, web, and admin
#   ./deploy/redeploy.sh --api          # pull + API only
#   ./deploy/redeploy.sh --web          # pull + web only
#   ./deploy/redeploy.sh --admin        # pull + admin only
#   ./deploy/redeploy.sh --require-media  # fail if LiveKit/coturn do not come up
#   ./deploy/redeploy.sh --skip-env-check # skip deploy/check-env.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DO_API=0
DO_WEB=0
DO_ADMIN=0
ANY_TARGET=0
REQUIRE_MEDIA=0
SKIP_ENV_CHECK=0

usage() {
  cat <<'EOF'
Pull latest changes, then rebuild and restart Qchat.

Usage:
  ./deploy/redeploy.sh
  ./deploy/redeploy.sh --api
  ./deploy/redeploy.sh --web
  ./deploy/redeploy.sh --admin
  ./deploy/redeploy.sh --require-media
  ./deploy/redeploy.sh --skip-env-check
EOF
  exit "${1:-0}"
}

for arg in "$@"; do
  case "$arg" in
    --api) DO_API=1; ANY_TARGET=1 ;;
    --web) DO_WEB=1; ANY_TARGET=1 ;;
    --admin) DO_ADMIN=1; ANY_TARGET=1 ;;
    --require-media) REQUIRE_MEDIA=1 ;;
    --skip-env-check) SKIP_ENV_CHECK=1 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $arg" >&2; usage 1 ;;
  esac
done

# Default: API + web + admin when no target flag is given.
if [[ "$ANY_TARGET" -eq 0 ]]; then
  DO_API=1
  DO_WEB=1
  DO_ADMIN=1
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

ENV_FILE="$ROOT/deploy/qchat-api.env"
ENV_EXAMPLE="$ROOT/deploy/qchat-api.env.example"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    log "create $ENV_FILE from example"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "warning: using example env; run ./deploy/rotate-jwt-secret.sh for production" >&2
  else
    echo "error: missing $ENV_FILE (and no example to copy)" >&2
    exit 1
  fi
fi

chmod +x "$ROOT/deploy/check-env.sh" "$ROOT/deploy/smoke-livekit.sh" "$ROOT/deploy/render-media-config.sh" 2>/dev/null || true

# Load API env so render-media-config inherits LIVEKIT_* / TURN_* (avoids
# overwriting rotated production keys with documented defaults).
# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

if [[ "$SKIP_ENV_CHECK" -eq 0 ]]; then
  log "check env"
  # Fail hard when QCHAT_ENV=production (warnings only in development).
  "$ROOT/deploy/check-env.sh" || {
    echo "error: env check failed; fix deploy/qchat-api.env or pass --skip-env-check" >&2
    exit 1
  }
else
  echo "warning: skipped env check (--skip-env-check)" >&2
fi

log "ensure TLS certs (HTTPS for mic/camera)"
chmod +x "$ROOT/deploy/generate-tls.sh"
"$ROOT/deploy/generate-tls.sh"

log "render LiveKit/coturn for this host"
"$ROOT/deploy/render-media-config.sh"
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source "$ROOT/deploy/generated/media.env"
set +a

MEDIA_OK=0
if (cd "$ROOT" && docker compose up -d livekit coturn); then
  echo "LiveKit: ${LIVEKIT_URL}"
  if "$ROOT/deploy/smoke-livekit.sh"; then
    MEDIA_OK=1
  else
    echo "warning: LiveKit smoke failed after compose up" >&2
  fi
else
  echo "warning: could not start livekit/coturn (is Docker running?)" >&2
fi

if [[ "$REQUIRE_MEDIA" -eq 1 && "$MEDIA_OK" -ne 1 ]]; then
  echo "error: --require-media set but LiveKit is not healthy" >&2
  exit 1
fi

# Re-check after media.env merge into qchat-api.env (render updates keys).
if [[ "$SKIP_ENV_CHECK" -eq 0 ]]; then
  "$ROOT/deploy/check-env.sh" || {
    echo "error: env check failed after media render (keys may still be defaults in production)" >&2
    exit 1
  }
fi

if [[ "$DO_API" -eq 1 ]]; then
  log "build API"
  mkdir -p "$ROOT/services/api/bin"
  (
    cd "$ROOT/services/api"
    go build -o bin/qchat-api ./cmd/api
  )

  log "restart qchat-api"
  if systemctl is-enabled qchat-api >/dev/null 2>&1 || systemctl cat qchat-api >/dev/null 2>&1; then
    systemctl reset-failed qchat-api 2>/dev/null || true
    systemctl restart qchat-api
  else
    echo "warning: qchat-api.service not installed; binary rebuilt at services/api/bin/qchat-api" >&2
    echo "         install with: ln -sfn $ROOT/deploy/qchat-api.service /etc/systemd/system/qchat-api.service && systemctl daemon-reload && systemctl enable --now qchat-api" >&2
  fi
fi

if [[ "$DO_WEB" -eq 1 ]]; then
  log "install web deps"
  (
    cd "$ROOT/apps/web"
    npm ci
  )

  log "build web (static export)"
  (
    cd "$ROOT/apps/web"
    # Empty NEXT_PUBLIC_API_URL → same-origin via nginx (not host:8080).
    # LiveKit URL comes from rendered media.env (wss when TLS certs exist).
    NEXT_PUBLIC_API_URL="" \
      NEXT_PUBLIC_LIVEKIT_URL="${NEXT_PUBLIC_LIVEKIT_URL:-}" \
      npm run build
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

if [[ "$DO_ADMIN" -eq 1 ]]; then
  log "install admin deps"
  (
    cd "$ROOT/apps/admin"
    npm ci
  )

  log "build admin (static export → /admin/)"
  (
    cd "$ROOT/apps/admin"
    NEXT_PUBLIC_API_URL="" npm run build
  )

  log "reload nginx"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t
    systemctl reload nginx
  else
    echo "warning: nginx not found; static files are in apps/admin/out/" >&2
  fi
fi

log "health checks"
if [[ "$DO_API" -eq 1 ]]; then
  curl -fsS --retry 5 --retry-delay 1 --retry-connrefused \
    http://127.0.0.1:8080/healthz >/dev/null
  echo "API  :8080/healthz OK"
fi

if command -v nginx >/dev/null 2>&1; then
  curl -kfsS --retry 3 --retry-delay 1 -o /dev/null https://127.0.0.1/
  echo "Web  :443/ OK"
  curl -kfsS --retry 3 --retry-delay 1 -o /dev/null https://127.0.0.1/admin/
  echo "Admin :443/admin/ OK"
  curl -kfsS --retry 3 --retry-delay 1 https://127.0.0.1/healthz >/dev/null
  echo "Nginx /healthz OK"
fi

if [[ "$MEDIA_OK" -eq 1 ]]; then
  echo "LiveKit smoke OK"
elif [[ "$REQUIRE_MEDIA" -eq 0 ]]; then
  echo "LiveKit smoke skipped/failed (pass --require-media to fail the deploy)"
fi

log "redeploy complete"
