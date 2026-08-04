#!/usr/bin/env bash
# Copy XinChat desktop/mobile build artifacts into apps/xin-web/public/downloads/
# and refresh manifest.json sizes. Does not build — run dist/eas first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/xin-web/public/downloads"
DESKTOP_DIST="$ROOT/apps/xin-desktop/dist"
MANIFEST="$DEST/manifest.json"

log() { printf '==> %s\n' "$*"; }

mkdir -p "$DEST"

copy_if_exists() {
  local src="$1"
  local name="$2"
  if [[ -f "$src" ]]; then
    cp -f "$src" "$DEST/$name"
    log "copied $name"
    return 0
  fi
  return 1
}

# Desktop artifacts (electron-builder naming from package.json)
if [[ -d "$DESKTOP_DIST" ]]; then
  for f in "$DESKTOP_DIST"/xinchat-desktop-Setup-*.exe; do
    [[ -f "$f" ]] && copy_if_exists "$f" "$(basename "$f")"
  done
  for f in "$DESKTOP_DIST"/xinchat-desktop-*.dmg; do
    [[ -f "$f" ]] && copy_if_exists "$f" "$(basename "$f")"
  done
  for f in "$DESKTOP_DIST"/xinchat-desktop-*.AppImage; do
    [[ -f "$f" ]] && copy_if_exists "$f" "$(basename "$f")"
  done
  for f in "$DESKTOP_DIST"/xinchat-desktop-*.deb; do
    [[ -f "$f" ]] && copy_if_exists "$f" "$(basename "$f")"
  done
else
  log "skip desktop (no $DESKTOP_DIST)"
fi

# Mobile APK from common local paths
for apk in \
  "$ROOT/apps/xin-mobile/build.apk" \
  "$ROOT/apps/xin-mobile/eas-output.apk" \
  "$DEST/xinchat-mobile.apk" \
  ; do
  if [[ -f "$apk" ]]; then
    copy_if_exists "$apk" "xinchat-mobile.apk"
    break
  fi
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "error: missing $MANIFEST" >&2
  exit 1
fi

# Update sizeBytes and available flags via node
DEST="$DEST" node <<'NODE'
const fs = require("fs");
const path = require("path");
const dest = process.env.DEST;
const manifestPath = path.join(dest, "manifest.json");
const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);
data.updatedAt = today;
for (const app of data.apps || []) {
  if (!app.file) continue;
  const fp = path.join(dest, app.file);
  if (fs.existsSync(fp)) {
    app.sizeBytes = fs.statSync(fp).size;
    app.available = true;
  } else {
    app.available = false;
    app.sizeBytes = null;
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2) + "\n");
console.log("updated manifest.json");
NODE

log "done — run ./deploy/redeploy.sh --xin-web to publish"
