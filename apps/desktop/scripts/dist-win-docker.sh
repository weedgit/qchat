#!/usr/bin/env bash
# Cross-build Windows NSIS installer on Linux via electronuserland/builder:wine.
#
# Usage (from apps/desktop or repo root via npm script):
#   ./scripts/dist-win-docker.sh
#   npm run dist:win:docker
#
# Optional signing: export CSC_LINK / CSC_KEY_PASSWORD (or WIN_CSC_*) before running.
# Artifacts land in apps/desktop/dist/ (qchat-desktop-Setup-*.exe).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${QCHAT_ELECTRON_WINE_IMAGE:-electronuserland/builder:wine}"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required for dist:win:docker" >&2
  exit 1
fi

mkdir -p "$ROOT/dist"
# Cache electron + electron-builder downloads across runs when possible.
ELECTRON_CACHE_VOL="${QCHAT_ELECTRON_CACHE:-qchat-electron-cache}"
BUILDER_CACHE_VOL="${QCHAT_ELECTRON_BUILDER_CACHE:-qchat-electron-builder-cache}"

echo "==> Windows NSIS via ${IMAGE}"
echo "    project: ${ROOT}"

docker run --rm \
  -e ELECTRON_CACHE=/root/.cache/electron \
  -e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
  ${CSC_LINK:+-e CSC_LINK} \
  ${CSC_KEY_PASSWORD:+-e CSC_KEY_PASSWORD} \
  ${WIN_CSC_LINK:+-e WIN_CSC_LINK} \
  ${WIN_CSC_KEY_PASSWORD:+-e WIN_CSC_KEY_PASSWORD} \
  -v "$ROOT":/project \
  -v "${ELECTRON_CACHE_VOL}":/root/.cache/electron \
  -v "${BUILDER_CACHE_VOL}":/root/.cache/electron-builder \
  -w /project \
  "$IMAGE" \
  /bin/bash -lc 'npm ci && npx electron-builder --win nsis --publish never'

echo
echo "Windows build complete. Look under:"
echo "  ${ROOT}/dist/qchat-desktop-Setup-*.exe"
ls -la "$ROOT/dist"/qchat-desktop-Setup-*.exe 2>/dev/null || ls -la "$ROOT/dist" || true
