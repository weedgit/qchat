#!/usr/bin/env bash
# Resolve eas CLI from apps/xin-mobile node_modules (avoids broken npx cache).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EAS="$ROOT/node_modules/.bin/eas"
if [[ ! -x "$EAS" ]]; then
  echo "error: run npm ci in apps/xin-mobile first" >&2
  exit 1
fi
exec "$EAS" "$@"
