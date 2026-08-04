#!/usr/bin/env bash
# Non-interactive EAS login for CI / VPS (requires Expo access token).
# Create token: https://expo.dev/accounts/[account]/settings/access-tokens
#
# Usage:
#   EXPO_TOKEN=xxx ./scripts/eas-ci-login.sh
#   # or add EXPO_TOKEN to apps/xin-mobile/.env (do not commit)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EAS="$ROOT/scripts/eas.sh"

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "error: set EXPO_TOKEN (env or apps/xin-mobile/.env)" >&2
  echo "Create at: https://expo.dev/settings/access-tokens" >&2
  exit 1
fi

export EXPO_TOKEN
"$EAS" whoami
echo "EAS token OK"
