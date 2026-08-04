#!/usr/bin/env bash
# Download the latest finished EAS Android build into apps/xin-mobile/build.apk
# Usage: ./scripts/eas-pull-xin-apk.sh [profile]   (default: preview)
set -euo pipefail

PROFILE="${1:-preview}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/xin-mobile"
OUT="$MOBILE/build.apk"
EAS="$MOBILE/scripts/eas.sh"

cd "$MOBILE"

if ! "$EAS" whoami >/dev/null 2>&1; then
  echo "error: not logged in — cd apps/xin-mobile && npm run eas:login" >&2
  exit 1
fi

# shellcheck disable=SC1090
if [[ -f .env ]]; then set -a; source .env; set +a; fi

log() { printf '==> %s\n' "$*"; }

log "find latest finished android build (profile=$PROFILE)"
BUILD_ID="$("$EAS" build:list \
  --platform android \
  --build-profile "$PROFILE" \
  --status finished \
  --limit 1 \
  --json \
  --non-interactive 2>/dev/null | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(2);
const data = JSON.parse(raw);
const row = Array.isArray(data) ? data[0] : data;
const id = row?.id || row?.builds?.[0]?.id;
if (!id) process.exit(3);
process.stdout.write(id);
')"

if [[ -z "$BUILD_ID" ]]; then
  echo "error: no finished android build for profile $PROFILE" >&2
  echo "Start one with: cd apps/xin-mobile && npm run eas:build:preview" >&2
  exit 1
fi

log "download build $BUILD_ID → build.apk"
rm -f "$OUT"
"$EAS" build:download --id "$BUILD_ID" --output "$OUT" --non-interactive

BYTES="$(wc -c < "$OUT" | tr -d ' ')"
log "saved $OUT ($BYTES bytes)"
echo ""
echo "Publish: make publish-xin"
