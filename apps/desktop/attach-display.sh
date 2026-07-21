#!/usr/bin/env bash
# Export display env vars for the active local user session (GNOME / Xwayland).
# Usage: source attach-display.sh   (must be sourced, not executed)

uid="$(id -u)"
runtime="/run/user/${uid}"

if [[ -d "$runtime" ]]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$runtime}"
fi

if [[ -z "${WAYLAND_DISPLAY:-}" && -S "${XDG_RUNTIME_DIR:-}/wayland-0" ]]; then
  export WAYLAND_DISPLAY=wayland-0
fi

if [[ -z "${DISPLAY:-}" ]]; then
  if [[ -S /tmp/.X11-unix/X0 ]]; then
    export DISPLAY=:0
  elif [[ -S /tmp/.X11-unix/X1 ]]; then
    export DISPLAY=:1
  fi
fi

if [[ -z "${XAUTHORITY:-}" && -n "${XDG_RUNTIME_DIR:-}" ]]; then
  auth="$(ls "${XDG_RUNTIME_DIR}"/.mutter-Xwaylandauth.* 2>/dev/null | head -1 || true)"
  if [[ -n "$auth" && -f "$auth" ]]; then
    export XAUTHORITY="$auth"
  fi
fi

if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  echo "Attached to GUI session: DISPLAY=${DISPLAY:-} WAYLAND=${WAYLAND_DISPLAY:-}"
else
  echo "Could not attach to a local GUI session." >&2
  return 1 2>/dev/null || exit 1
fi
