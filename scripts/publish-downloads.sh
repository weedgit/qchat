#!/usr/bin/env bash
# Copy built desktop/mobile artifacts into apps/web/public/downloads/
# and print a reminder to flip available=true in manifest.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/web/public/downloads"
DESKTOP_DIST="$ROOT/apps/desktop/dist"
MOBILE_DIST="$ROOT/apps/mobile/dist"

mkdir -p "$DEST"

copied=0
copy_glob() {
  local pattern="$1"
  local dest_name="${2:-}"
  shopt -s nullglob
  local files=($pattern)
  shopt -u nullglob
  if ((${#files[@]} == 0)); then
    return 0
  fi
  local src="${files[0]}"
  local name
  if [[ -n "$dest_name" ]]; then
    name="$dest_name"
  else
    name="$(basename "$src")"
  fi
  cp -f "$src" "$DEST/$name"
  echo "  + $name  ←  $src"
  copied=$((copied + 1))
}

echo "Publishing downloads → $DEST"
copy_glob "$DESKTOP_DIST/qchat-desktop-Setup-"*.exe
copy_glob "$DESKTOP_DIST/qchat-desktop-"*.dmg
copy_glob "$DESKTOP_DIST/qchat-desktop-"*.AppImage
copy_glob "$DESKTOP_DIST/qchat-desktop_"*.deb
copy_glob "$DESKTOP_DIST/qchat-desktop-"*.deb
copy_glob "$MOBILE_DIST/"*.apk "qchat-mobile.apk"
copy_glob "$ROOT/apps/mobile/"*.apk "qchat-mobile.apk"

if ((copied == 0)); then
  echo "No artifacts found. Build first, then re-run:"
  echo "  cd apps/desktop && npm run dist:win   # or dist:mac / dist:linux"
  echo "  # mobile: place APK in apps/mobile/dist/ or apps/mobile/"
  exit 1
fi

echo
echo "Copied $copied file(s). Update apps/web/public/downloads/manifest.json:"
echo "  - set matching \"file\" names"
echo "  - set \"available\": true"
echo "  - bump \"version\" / \"updatedAt\""
echo "Then rebuild/redeploy the web app."
