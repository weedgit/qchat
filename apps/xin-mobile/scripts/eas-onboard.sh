#!/usr/bin/env bash
# Guided one-time XinChat EAS setup (separate Expo project from Rchat).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EAS="$ROOT/scripts/eas.sh"

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }

log "install deps"
npm ci

log "Expo account"
if "$EAS" whoami >/dev/null 2>&1; then
  echo "logged in as: $("$EAS" whoami 2>/dev/null | head -1)"
else
  echo "Not logged in. Run: cd apps/xin-mobile && npm run eas:login"
  exit 1
fi

ENV_FILE="$ROOT/.env"
EXAMPLE="$ROOT/.env.example"
if [[ ! -f "$ENV_FILE" ]]; then
  log "create .env from .env.example"
  cp "$EXAMPLE" "$ENV_FILE"
  warn "edit $ENV_FILE — set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_LIVEKIT_URL"
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [[ -z "${EAS_PROJECT_ID:-}" ]]; then
  log "link XinChat to a new Expo project (not the Rchat project)"
  echo "When prompted, create a NEW project for slug xinchat / com.xinchat.mobile."
  "$EAS" init

  if [[ -f app.json ]]; then
    PID="$(node -e 'const j=require("./app.json"); process.stdout.write(j.extra?.eas?.projectId||"")')"
    if [[ -n "$PID" ]]; then
      if grep -q '^EAS_PROJECT_ID=' "$ENV_FILE"; then
        sed -i "s/^EAS_PROJECT_ID=.*/EAS_PROJECT_ID=$PID/" "$ENV_FILE"
      else
        echo "EAS_PROJECT_ID=$PID" >> "$ENV_FILE"
      fi
      echo "saved EAS_PROJECT_ID to .env"
    fi
  fi

  if [[ -z "${EAS_PROJECT_ID:-}" ]]; then
    warn "set EAS_PROJECT_ID in .env after init (Expo dashboard → Project settings)"
  fi
else
  echo "EAS_PROJECT_ID already set in .env"
fi

log "release profile checks (local)"
npm run typecheck
npm run check:release

log "configure signing (interactive)"
echo "Run credentials when ready:"
echo "  npm run eas:credentials:android"
echo "  npm run eas:credentials:ios"
echo ""
echo "First internal APK:"
echo "  npm run eas:build:preview"
echo ""
echo "After build finishes:"
echo "  ../../scripts/eas-pull-xin-apk.sh preview"
echo "  make publish-xin"
