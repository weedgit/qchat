#!/usr/bin/env bash
# Validate deploy/qchat-api.env (and optional generated media.env) before redeploy.
#
# Usage:
#   ./deploy/check-env.sh              # warn in development; fail in production
#   ./deploy/check-env.sh --strict     # always fail on weak / missing secrets
#   ./deploy/check-env.sh --warn-only  # never exit non-zero (CI / dry run)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${QCHAT_ENV_FILE:-$ROOT/deploy/qchat-api.env}"
MEDIA_ENV="$ROOT/deploy/generated/media.env"
STRICT=0
WARN_ONLY=0

DEFAULT_JWT="dev-qchat-secret-change-me"
DEFAULT_LK_KEY="devkey"
DEFAULT_LK_SECRET="secret-that-is-at-least-32-characters-long"
DEFAULT_TURN_PASS="qchatturnsecret"

usage() {
  cat <<'EOF'
Validate Qchat API / media env before deploy.

Usage:
  ./deploy/check-env.sh
  ./deploy/check-env.sh --strict
  ./deploy/check-env.sh --warn-only

Environment:
  QCHAT_ENV_FILE   path to env file (default: deploy/qchat-api.env)
EOF
  exit "${1:-0}"
}

for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    --warn-only) WARN_ONLY=1 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $arg" >&2; usage 1 ;;
  esac
done

ERRORS=0
WARNINGS=0

fail() {
  echo "error: $*" >&2
  ERRORS=$((ERRORS + 1))
}

warn() {
  echo "warning: $*" >&2
  WARNINGS=$((WARNINGS + 1))
}

ok() { echo "ok: $*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  fail "missing $ENV_FILE (copy from deploy/qchat-api.env.example and rotate secrets)"
  if [[ "$WARN_ONLY" -eq 1 ]]; then
    exit 0
  fi
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

QCHAT_ENV_VAL="$(echo "${QCHAT_ENV:-development}" | tr '[:upper:]' '[:lower:]')"
IS_PROD=0
if [[ "$QCHAT_ENV_VAL" == "production" || "$STRICT" -eq 1 ]]; then
  IS_PROD=1
fi

issue() {
  if [[ "$IS_PROD" -eq 1 ]]; then
    fail "$1"
  else
    warn "$1"
  fi
}

# --- JWT ---
if [[ -z "${QCHAT_JWT_SECRET:-}" || "$QCHAT_JWT_SECRET" == "$DEFAULT_JWT" ]]; then
  issue "QCHAT_JWT_SECRET is missing or still the example default — run ./deploy/rotate-jwt-secret.sh"
elif [[ "${#QCHAT_JWT_SECRET}" -lt 32 ]]; then
  issue "QCHAT_JWT_SECRET must be at least 32 characters"
else
  ok "QCHAT_JWT_SECRET length ${#QCHAT_JWT_SECRET}"
fi

# --- LiveKit ---
LK_KEY="${LIVEKIT_API_KEY:-}"
LK_SECRET="${LIVEKIT_API_SECRET:-}"
LK_URL="${LIVEKIT_URL:-}"

if [[ -z "$LK_URL" ]]; then
  issue "LIVEKIT_URL is empty (run ./deploy/render-media-config.sh)"
else
  ok "LIVEKIT_URL=$LK_URL"
fi

if [[ -z "$LK_KEY" || "$LK_KEY" == "$DEFAULT_LK_KEY" ]]; then
  issue "LIVEKIT_API_KEY is missing or still '$DEFAULT_LK_KEY' — set a unique key for production"
else
  ok "LIVEKIT_API_KEY is set"
fi

if [[ -z "$LK_SECRET" || "$LK_SECRET" == "$DEFAULT_LK_SECRET" ]]; then
  issue "LIVEKIT_API_SECRET is missing or still the documented default — generate a unique ≥32-char secret"
elif [[ "${#LK_SECRET}" -lt 32 ]]; then
  issue "LIVEKIT_API_SECRET must be at least 32 characters"
else
  ok "LIVEKIT_API_SECRET length ${#LK_SECRET}"
fi

# --- Optional TURN (from shell env or coturn render) ---
if [[ -n "${TURN_PASS:-}" && "$TURN_PASS" == "$DEFAULT_TURN_PASS" ]]; then
  issue "TURN_PASS is still the example default ($DEFAULT_TURN_PASS)"
fi

# --- media.env consistency ---
if [[ -f "$MEDIA_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$MEDIA_ENV"
  set +a
  if [[ -n "${LIVEKIT_API_KEY:-}" && -n "$LK_KEY" && "${LIVEKIT_API_KEY}" != "$LK_KEY" ]]; then
    issue "LIVEKIT_API_KEY mismatch between $ENV_FILE and $MEDIA_ENV"
  fi
  if [[ -n "${LIVEKIT_API_SECRET:-}" && -n "$LK_SECRET" && "${LIVEKIT_API_SECRET}" != "$LK_SECRET" ]]; then
    issue "LIVEKIT_API_SECRET mismatch between $ENV_FILE and $MEDIA_ENV"
  fi
  if [[ -n "${LIVEKIT_URL:-}" && -n "$LK_URL" && "${LIVEKIT_URL}" != "$LK_URL" ]]; then
    warn "LIVEKIT_URL differs: api env=$LK_URL media.env=${LIVEKIT_URL} (re-run render-media-config if unexpected)"
  fi
  ok "checked $MEDIA_ENV against API env"
else
  warn "missing $MEDIA_ENV — run ./deploy/render-media-config.sh before starting LiveKit"
fi

echo
echo "check-env: env=$QCHAT_ENV_VAL errors=$ERRORS warnings=$WARNINGS"

if [[ "$WARN_ONLY" -eq 1 ]]; then
  exit 0
fi
if [[ "$ERRORS" -gt 0 ]]; then
  exit 1
fi
exit 0
