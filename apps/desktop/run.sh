#!/usr/bin/env bash
# Preflight for Electron: require a graphical display, then start the app.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  cat >&2 <<'EOF'
Qchat Desktop needs a graphical session (X11 or Wayland).

Your shell has no $DISPLAY / $WAYLAND_DISPLAY — common when using SSH or a
text console (tty). Electron cannot open a window from here.

Fix (pick one):
  1. On the Ubuntu desktop, open Terminal from the GUI and run:
       cd ~/Desktop/chatapp/qchat/apps/desktop
       QCHAT_WEB_URL=http://135.181.224.36 npm start

  2. If you SSH in, enable X11 forwarding and use an X server on your laptop:
       ssh -X ubuntu@<host>
       cd ~/Desktop/chatapp/qchat/apps/desktop && npm start

  3. Or attach to the existing local desktop session (same machine, user logged
     into GNOME), then:
       export DISPLAY=:0
       # if needed: export XAUTHORITY=/run/user/$(id -u)/.mutter-Xwaylandauth.*
       npm start

Headless smoke (no visible window) requires xvfb:
  sudo apt-get install -y xvfb
  xvfb-run -a npm start
EOF
  exit 1
fi

exec npm start -- "$@"
