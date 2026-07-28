#!/usr/bin/env bash
# Render LiveKit + coturn configs for this host (local / VM / VPS).
#
# Host resolution order:
#   1. --host <ip-or-dns>
#   2. LIVEKIT_NODE_IP
#   3. QCHAT_PUBLIC_HOST
#   4. Default-route source IPv4 (auto)
#
# Usage:
#   ./deploy/render-media-config.sh
#   ./deploy/render-media-config.sh --host 203.0.113.10
#   LIVEKIT_NODE_IP=192.168.1.50 ./deploy/render-media-config.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/generated"
HOST_OVERRIDE=""
STRICT=0

usage() {
  cat <<'EOF'
Render LiveKit + coturn configs for the current machine.

Usage:
  ./deploy/render-media-config.sh
  ./deploy/render-media-config.sh --host <ip-or-dns>
  ./deploy/render-media-config.sh --strict

Environment (optional):
  LIVEKIT_NODE_IP / QCHAT_PUBLIC_HOST   browser-reachable host
  LIVEKIT_API_KEY / LIVEKIT_API_SECRET  must match the API process
  TURN_USER / TURN_PASS                 coturn credentials
  QCHAT_ENV=production                  same as --strict (refuse default secrets)
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST_OVERRIDE="${2:-}"
      [[ -n "$HOST_OVERRIDE" ]] || usage 1
      shift 2
      ;;
    --strict) STRICT=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

QCHAT_ENV_VAL="$(echo "${QCHAT_ENV:-development}" | tr '[:upper:]' '[:lower:]')"
if [[ "$QCHAT_ENV_VAL" == "production" ]]; then
  STRICT=1
fi
if [[ "$STRICT" -eq 0 && -f "$ROOT/deploy/qchat-api.env" ]]; then
  env_line="$(grep -E '^QCHAT_ENV=' "$ROOT/deploy/qchat-api.env" | tail -n1 || true)"
  case "$env_line" in
    QCHAT_ENV=production|QCHAT_ENV=PRODUCTION) STRICT=1 ;;
  esac
fi

is_private_or_loopback() {
  case "$1" in
    127.*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|localhost) return 0 ;;
    *) return 1 ;;
  esac
}

detect_host() {
  if [[ -n "$HOST_OVERRIDE" ]]; then
    printf '%s\n' "$HOST_OVERRIDE"
    return
  fi
  if [[ -n "${LIVEKIT_NODE_IP:-}" ]]; then
    printf '%s\n' "$LIVEKIT_NODE_IP"
    return
  fi
  if [[ -n "${QCHAT_PUBLIC_HOST:-}" ]]; then
    printf '%s\n' "$QCHAT_PUBLIC_HOST"
    return
  fi

  local detected=""
  if command -v ip >/dev/null 2>&1; then
    detected="$(ip -4 route get 1.1.1.1 2>/dev/null \
      | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)"
  fi
  if [[ -z "$detected" ]] && command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [[ -z "$detected" ]]; then
    echo "error: could not auto-detect host IP; pass --host or set LIVEKIT_NODE_IP" >&2
    exit 1
  fi
  printf '%s\n' "$detected"
}

replace_all() {
  # portable sed: escape | in values for delimiter safety is overkill for IPs/secrets here
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[&\\]/\\&/g')"
  sed -i "s|${key}|${escaped}|g" "$file"
}

HOST="$(detect_host)"
API_KEY="${LIVEKIT_API_KEY:-devkey}"
API_SECRET="${LIVEKIT_API_SECRET:-secret-that-is-at-least-32-characters-long}"
TURN_USER="${TURN_USER:-qchat}"
TURN_PASS="${TURN_PASS:-qchatturnsecret}"

DEFAULT_LK_KEY="devkey"
DEFAULT_LK_SECRET="secret-that-is-at-least-32-characters-long"
DEFAULT_TURN_PASS="qchatturnsecret"

if [[ "$STRICT" -eq 1 ]]; then
  if [[ "$API_KEY" == "$DEFAULT_LK_KEY" ]]; then
    echo "error: production/strict refuse default LIVEKIT_API_KEY=$DEFAULT_LK_KEY; export a unique LIVEKIT_API_KEY" >&2
    exit 1
  fi
  if [[ "$API_SECRET" == "$DEFAULT_LK_SECRET" ]]; then
    echo "error: production/strict refuse default LIVEKIT_API_SECRET; export a unique ≥32-char LIVEKIT_API_SECRET" >&2
    exit 1
  fi
  if [[ "$TURN_PASS" == "$DEFAULT_TURN_PASS" ]]; then
    echo "error: production/strict refuse default TURN_PASS; export a unique TURN_PASS" >&2
    exit 1
  fi
fi

if [[ "${#API_SECRET}" -lt 32 ]]; then
  echo "error: LIVEKIT_API_SECRET must be at least 32 characters" >&2
  exit 1
fi

ENABLE_LOOPBACK="false"
if [[ "$HOST" == "127.0.0.1" || "$HOST" == "localhost" ]]; then
  ENABLE_LOOPBACK="true"
fi

mkdir -p "$OUT"
cp "$ROOT/deploy/livekit.yaml.template" "$OUT/livekit.yaml"
cp "$ROOT/deploy/coturn.conf.template" "$OUT/coturn.conf"

replace_all "$OUT/livekit.yaml" "__QCHAT_HOST__" "$HOST"
replace_all "$OUT/livekit.yaml" "__LIVEKIT_API_KEY__" "$API_KEY"
replace_all "$OUT/livekit.yaml" "__LIVEKIT_API_SECRET__" "$API_SECRET"
replace_all "$OUT/livekit.yaml" "__TURN_USER__" "$TURN_USER"
replace_all "$OUT/livekit.yaml" "__TURN_PASS__" "$TURN_PASS"
replace_all "$OUT/livekit.yaml" "__ENABLE_LOOPBACK__" "$ENABLE_LOOPBACK"

replace_all "$OUT/coturn.conf" "__QCHAT_HOST__" "$HOST"
replace_all "$OUT/coturn.conf" "__TURN_USER__" "$TURN_USER"
replace_all "$OUT/coturn.conf" "__TURN_PASS__" "$TURN_PASS"

SCHEME="ws"
LIVEKIT_PORT="7880"
# When TLS certs exist (./deploy/generate-tls.sh), browsers use WSS via nginx :7443.
if [[ -f "$ROOT/deploy/certs/qchat.crt" && -f "$ROOT/deploy/certs/qchat.key" ]]; then
  SCHEME="wss"
  LIVEKIT_PORT="7443"
fi
# Callers behind HTTPS should set LIVEKIT_URL=wss://… themselves in qchat-api.env.
cat >"$OUT/media.env" <<EOF
# Auto-generated by deploy/render-media-config.sh — do not commit.
LIVEKIT_NODE_IP=${HOST}
LIVEKIT_URL=${SCHEME}://${HOST}:${LIVEKIT_PORT}
LIVEKIT_API_KEY=${API_KEY}
LIVEKIT_API_SECRET=${API_SECRET}
NEXT_PUBLIC_LIVEKIT_URL=${SCHEME}://${HOST}:${LIVEKIT_PORT}
EOF

# Per-machine web env (gitignored via apps/web/.env*.local).
WEB_ENV="$ROOT/apps/web/.env.local"
cat >"$WEB_ENV" <<EOF
# Auto-generated by deploy/render-media-config.sh for host ${HOST}
# Re-run after IP/DNS change: ./deploy/render-media-config.sh [--host <ip>]
# Do not commit — apps/web/.gitignore covers .env*.local

# Browser must reach LiveKit on this machine's reachable IP/DNS (not Cursor-forwarded localhost).
NEXT_PUBLIC_LIVEKIT_URL=${SCHEME}://${HOST}:${LIVEKIT_PORT}

# Empty = same-origin (next dev rewrites /v1 → API). Avoids captcha timeout when only :3000 is forwarded.
# Production nginx builds also use "". To pin a direct API host instead:
# NEXT_PUBLIC_API_URL=http://${HOST}:8080
NEXT_PUBLIC_API_URL=
EOF

# Keep systemd API env in sync with LiveKit URL/keys (merge into qchat-api.env).
API_ENV="$ROOT/deploy/qchat-api.env"
if [[ -f "$API_ENV" ]]; then
  tmp="$(mktemp)"
  grep -vE '^(LIVEKIT_NODE_IP|LIVEKIT_URL|LIVEKIT_API_KEY|LIVEKIT_API_SECRET)=' "$API_ENV" >"$tmp" || true
  {
    echo "LIVEKIT_NODE_IP=${HOST}"
    echo "LIVEKIT_URL=${SCHEME}://${HOST}:${LIVEKIT_PORT}"
    echo "LIVEKIT_API_KEY=${API_KEY}"
    echo "LIVEKIT_API_SECRET=${API_SECRET}"
  } >>"$tmp"
  mv "$tmp" "$API_ENV"
  chmod 600 "$API_ENV" 2>/dev/null || true
fi

cat <<EOF
Rendered media config for host: ${HOST}
  ${OUT}/livekit.yaml
  ${OUT}/coturn.conf
  ${OUT}/media.env
  ${WEB_ENV}
  LiveKit browser URL: ${SCHEME}://${HOST}:${LIVEKIT_PORT}

Next:
  docker compose up -d livekit coturn
  # API: EnvironmentFile deploy/qchat-api.env (LiveKit keys merged when present)
  # Web (dev): apps/web/.env.local is ready — npm run dev / make web
  # HTTPS mic/calls: ./deploy/generate-tls.sh && systemctl reload nginx → https://${HOST}/
EOF

if is_private_or_loopback "$HOST"; then
  echo "note: ${HOST} looks local/private — fine for LAN/VM; use a public IP/DNS on a VPS." >&2
fi
