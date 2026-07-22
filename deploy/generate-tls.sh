#!/usr/bin/env bash
# Create a self-signed TLS cert for this host (IP or DNS).
# Enough for Chrome secure context (mic/camera) after accepting the browser warning.
# For a real domain, replace with Let's Encrypt and point nginx at those files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="${QCHAT_CERT_DIR:-$ROOT/deploy/certs}"
HOST_OVERRIDE=""

usage() {
  cat <<'EOF'
Generate self-signed TLS certs for Qchat nginx.

Usage:
  ./deploy/generate-tls.sh
  ./deploy/generate-tls.sh --host 203.0.113.10
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
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

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
  if [[ -z "$detected" ]]; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [[ -z "$detected" ]]; then
    echo "error: could not detect host; pass --host" >&2
    exit 1
  fi
  printf '%s\n' "$detected"
}

HOST="$(detect_host)"
mkdir -p "$CERT_DIR"
KEY="$CERT_DIR/qchat.key"
CRT="$CERT_DIR/qchat.crt"
CNF="$CERT_DIR/openssl.cnf"

# Reuse existing cert if it already covers this host and is not expired.
if [[ -f "$KEY" && -f "$CRT" ]]; then
  if openssl x509 -in "$CRT" -noout -checkend 86400 >/dev/null 2>&1; then
    if openssl x509 -in "$CRT" -noout -text 2>/dev/null | grep -q "$HOST"; then
      echo "TLS cert already present for ${HOST}: $CRT"
      exit 0
    fi
  fi
fi

SAN="DNS:localhost,IP:127.0.0.1"
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="${SAN},IP:${HOST}"
else
  SAN="${SAN},DNS:${HOST}"
fi

cat >"$CNF" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${HOST}

[v3_req]
subjectAltName = ${SAN}
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$KEY" -out "$CRT" -config "$CNF" >/dev/null 2>&1

chmod 600 "$KEY"
chmod 644 "$CRT"
echo "Wrote TLS cert for ${HOST}"
echo "  $CRT"
echo "  $KEY"
echo "Open https://${HOST}/ and accept the browser warning once (self-signed)."
