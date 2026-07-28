#!/usr/bin/env bash
# Wrapper for services/api ws_soak with sensible defaults.
#
# Usage:
#   ./deploy/soak.sh                      # 1k sockets, single seed user
#   ./deploy/soak.sh --multi              # 50 users × 200 sockets
#   ./deploy/soak.sh --multi --base2 http://127.0.0.1:8081
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/api"
BASE="${QCHAT_SOAK_BASE:-http://127.0.0.1:8080}"
BASE2="${QCHAT_SOAK_BASE2:-}"
MODE="single"
EXTRA=()

usage() {
  cat <<'EOF'
Run the WebSocket soak harness.

Usage:
  ./deploy/soak.sh
  ./deploy/soak.sh --multi
  ./deploy/soak.sh --multi --base2 http://127.0.0.1:8081
  ./deploy/soak.sh -- [ws_soak flags...]

Environment:
  QCHAT_SOAK_BASE / QCHAT_SOAK_BASE2
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --multi) MODE="multi"; shift ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --base2) BASE2="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    --) shift; EXTRA+=("$@"); break ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

ARGS=(-base "$BASE" -check-metrics=true)
if [[ -n "$BASE2" ]]; then
  ARGS+=(-base2 "$BASE2")
fi

if [[ "$MODE" == "multi" ]]; then
  ARGS+=(-n 200 -users 50 -latency-rounds 10)
else
  ARGS+=(-n 1000 -users 1 -latency-rounds 20)
fi

ARGS+=("${EXTRA[@]}")

echo "==> go run ./cmd/ws_soak ${ARGS[*]}"
cd "$API_DIR"
exec go run ./cmd/ws_soak "${ARGS[@]}"
