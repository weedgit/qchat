#!/usr/bin/env bash
# Copy XinChat desktop build artifacts to the nginx auto-update directory.
#
# Usage:
#   ./scripts/sync-xin-desktop-updates.sh
#   DEST=/var/www/xin-desktop-updates ./scripts/sync-xin-desktop-updates.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/xin-desktop/dist"
DEST="${DEST:-/var/www/xin-desktop-updates}"

log() { printf '==> %s\n' "$*"; }

if [[ ! -d "$SRC" ]]; then
  echo "error: missing $SRC — run apps/xin-desktop npm run dist:linux first" >&2
  exit 1
fi

mkdir -p "$DEST"

copied=0
copy_file() {
  local f="$1"
  if [[ -f "$f" ]]; then
    cp -f "$f" "$DEST/"
    log "copied $(basename "$f")"
    copied=$((copied + 1))
  fi
}

copy_if() {
  local pattern="${1:-}"
  if [[ -z "$pattern" ]]; then
    return 0
  fi
  shopt -s nullglob
  local files=($pattern)
  shopt -u nullglob
  for f in "${files[@]}"; do
    copy_file "$f"
  done
}

shopt -s nullglob
for f in "$SRC"/latest*.yml; do
  copy_file "$f"
done
shopt -u nullglob
copy_if "$SRC/"*.blockmap
copy_if "$SRC/xinchat-desktop-Setup-"*.exe
copy_if "$SRC/xinchat-desktop-"*.dmg
copy_if "$SRC/xinchat-desktop-"*.AppImage
copy_if "$SRC/xinchat-desktop-"*.deb

if [[ "$copied" -eq 0 ]]; then
  echo "warning: no artifacts matched in $SRC" >&2
  echo "Build first: cd apps/xin-desktop && npm run dist:linux" >&2
  exit 1
fi

log "feed ready at $DEST"
echo "Clients poll: https://<host>/xin-desktop-updates/"
