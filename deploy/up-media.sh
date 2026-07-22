#!/usr/bin/env bash
# Render LiveKit/coturn for this host, then start the media containers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/deploy/render-media-config.sh" "$@"

# shellcheck disable=SC1091
set -a
source "$ROOT/deploy/generated/media.env"
set +a

cd "$ROOT"
docker compose up -d livekit coturn
echo "LiveKit signaling: ${LIVEKIT_URL}"
