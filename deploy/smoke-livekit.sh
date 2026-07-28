#!/usr/bin/env bash
# Smoke: LiveKit signal HTTP is reachable after media deploy.
#
# Usage:
#   ./deploy/smoke-livekit.sh
#   LIVEKIT_HTTP=http://127.0.0.1:7880 ./deploy/smoke-livekit.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA_ENV="$ROOT/deploy/generated/media.env"

if [[ -f "$MEDIA_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$MEDIA_ENV"
  set +a
fi

# LiveKit serves HTTP on the signal port (7880) even when browsers use WSS :7443.
HTTP_BASE="${LIVEKIT_HTTP:-http://127.0.0.1:7880}"

echo "== LiveKit HTTP $HTTP_BASE =="
# LiveKit returns a small JSON/text body on GET /; accept any 2xx/3xx.
code="$(curl -sS -o /tmp/qchat-livekit-smoke.out -w '%{http_code}' --retry 5 --retry-delay 1 --retry-connrefused \
  "$HTTP_BASE/" || true)"
if [[ "$code" != 2* && "$code" != 3* ]]; then
  echo "error: LiveKit HTTP GET / returned status ${code:-none}" >&2
  [[ -f /tmp/qchat-livekit-smoke.out ]] && head -c 200 /tmp/qchat-livekit-smoke.out >&2 || true
  exit 1
fi
echo "livekit http ok (status $code)"

if [[ -n "${LIVEKIT_URL:-}" ]]; then
  echo "LIVEKIT_URL=${LIVEKIT_URL}"
fi

echo "SMOKE_LIVEKIT_OK"
