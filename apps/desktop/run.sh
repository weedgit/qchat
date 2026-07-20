#!/usr/bin/env bash
# Start Qchat Desktop. Auto-attaches to the local GNOME session when DISPLAY is unset
# (common in Cursor/SSH/tty terminals on the same machine as the desktop).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

die_no_display() {
  cat >&2 <<'EOF'
Qchat Desktop needs a graphical session (X11 or Wayland).

This terminal has no usable $DISPLAY / $WAYLAND_DISPLAY. Electron cannot open a window.

Try one of these:

  1. Ubuntu desktop → open Terminal from the GUI (not Cursor/SSH), then:
       cd ~/Desktop/chatapp/qchat/apps/desktop
       npm start

  2. From this terminal, attach to the logged-in desktop session:
       source ./attach-display.sh
       npm start

  3. SSH with X11 forwarding (X server required on your laptop):
       ssh -X ubuntu@<host>

  4. Headless smoke only (no visible window):
       sudo apt-get install -y xvfb
       xvfb-run -a npm start
EOF
  exit 1
}

# Source attach-display if present (sets DISPLAY / WAYLAND / XAUTHORITY when possible).
if [[ -f "$ROOT/attach-display.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/attach-display.sh" || true
fi

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  die_no_display
fi

# Prefer Wayland on modern Ubuntu when the socket exists.
if [[ -n "${WAYLAND_DISPLAY:-}" && -z "${ELECTRON_OZONE_PLATFORM:-}" ]]; then
  export ELECTRON_OZONE_PLATFORM=wayland
fi

export ELECTRON_DISABLE_SANDBOX="${ELECTRON_DISABLE_SANDBOX:-1}"
exec electron . --no-sandbox "$@"
