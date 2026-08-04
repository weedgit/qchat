#!/usr/bin/env bash
# Connect Linux Metro/API to an Android emulator running on the Windows host.
# VMware guest default gateway is usually the Windows host (e.g. 192.168.91.2).
set -euo pipefail

WINDOWS_HOST="${WINDOWS_ADB_HOST:-$(ip -4 route show default | awk '/default/{print $3; exit}')}"
ADB_PORT="${WINDOWS_ADB_PORT:-5037}"

if ! command -v adb >/dev/null; then
  echo "adb not found. Install platform tools on Linux:" >&2
  echo "  sudo pacman -S android-tools" >&2
  exit 1
fi

echo "Using Windows adb server at ${WINDOWS_HOST}:${ADB_PORT}"
export ANDROID_ADB_SERVER_ADDRESS="$WINDOWS_HOST"
export ANDROID_ADB_SERVER_PORT="$ADB_PORT"

adb start-server >/dev/null 2>&1 || true
adb devices -l

# Tunnel emulator localhost → this Linux VM (Metro + API).
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8080 tcp:8080
echo "Reversed: emulator :8081→Metro, :8080→API on this VM"
adb reverse --list

echo
echo "Next (this VM):"
echo "  cd apps/mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 npx expo start"
echo "Then in Expo Go on the emulator open:  exp://127.0.0.1:8081"
echo "Or press a if Expo can see the device via adb."
