#!/usr/bin/env bash
# Cloud build: XinChat preview APK (internal QA, trusts self-signed cert).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EAS="$ROOT/scripts/eas.sh"

if ! "$EAS" whoami >/dev/null 2>&1; then
  echo "error: run npm run eas:login" >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

npm run check:release

echo "==> EAS build profile=preview platform=android (com.xinchat.mobile)"
"$EAS" build --profile preview --platform android --non-interactive

echo ""
echo "When finished:"
echo "  ../../scripts/eas-pull-xin-apk.sh preview"
echo "  make publish-xin"
