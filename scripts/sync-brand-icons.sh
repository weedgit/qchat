#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/branding/qchat-icon-512.png"

if command -v magick >/dev/null; then
  IM=(magick)
elif command -v convert >/dev/null; then
  IM=(convert)
else
  echo "ImageMagick (magick/convert) is required to sync brand icons." >&2
  exit 1
fi

mkdir -p \
  "$ROOT/apps/web/public/icons" \
  "$ROOT/apps/admin/public/icons" \
  "$ROOT/apps/web/public/downloads/images" \
  "$ROOT/apps/desktop/assets" \
  "$ROOT/apps/mobile/assets"

"${IM[@]}" "$SOURCE" -resize 192x192 -strip "$ROOT/apps/web/public/icons/icon-192.png"
cp "$SOURCE" "$ROOT/apps/web/public/icons/icon-512.png"
"${IM[@]}" "$SOURCE" -resize 180x180 -strip "$ROOT/apps/web/public/icons/apple-touch-icon.png"
"${IM[@]}" "$SOURCE" -resize 32x32 -strip "$ROOT/apps/web/public/favicon.png"
"${IM[@]}" "$SOURCE" -resize 410x410 -background '#0d1724' -gravity center -extent 512x512 -strip \
  "$ROOT/apps/web/public/icons/icon-maskable-512.png"
"${IM[@]}" "$ROOT/apps/web/public/icons/icon-maskable-512.png" -resize 192x192 -strip \
  "$ROOT/apps/web/public/icons/icon-maskable-192.png"

# Download page brand mark (keep filename for existing hrefs).
cp "$ROOT/apps/web/public/icons/icon-192.png" "$ROOT/apps/web/public/downloads/images/qchat-icon.png"

cp "$ROOT/apps/web/public/icons/icon-192.png" "$ROOT/apps/admin/public/icons/icon-192.png"
cp "$ROOT/apps/web/public/icons/icon-512.png" "$ROOT/apps/admin/public/icons/icon-512.png"
cp "$ROOT/apps/web/public/icons/apple-touch-icon.png" "$ROOT/apps/admin/public/icons/apple-touch-icon.png"
cp "$ROOT/apps/web/public/favicon.png" "$ROOT/apps/admin/public/favicon.png"

for size in 16 32 48 64 128 256 512; do
  "${IM[@]}" "$SOURCE" -resize "${size}x${size}" -strip "$ROOT/apps/desktop/assets/icon-${size}.png"
done
cp "$SOURCE" "$ROOT/apps/desktop/assets/icon.png"
cp "$SOURCE" "$ROOT/apps/mobile/assets/qchat-icon-512.png"
cp "$SOURCE" "$ROOT/apps/mobile/assets/icon.png"
"${IM[@]}" "$SOURCE" -resize 1024x1024 -strip "$ROOT/apps/mobile/assets/adaptive-icon.png"

# Windows taskbar / NSIS require a real .ico (PNG shows as a blank document).
"${IM[@]}" "$ROOT/apps/desktop/assets/icon-16.png" \
  "$ROOT/apps/desktop/assets/icon-32.png" \
  "$ROOT/apps/desktop/assets/icon-48.png" \
  "$ROOT/apps/desktop/assets/icon-64.png" \
  "$ROOT/apps/desktop/assets/icon-128.png" \
  "$ROOT/apps/desktop/assets/icon-256.png" \
  "$ROOT/apps/desktop/assets/icon.ico"

echo "Rchat icons synced from branding/qchat-icon-512.png"
