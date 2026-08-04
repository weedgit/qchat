#!/usr/bin/env bash
# Verify XinChat desktop auto-update feed is served by nginx.
set -euo pipefail

BASE="${BASE:-https://127.0.0.1}"
CURL=(curl -kfsS --retry 2 --retry-delay 1)

check() {
  local path="$1"
  local code
  code="$(curl -k -o /dev/null -w '%{http_code}' -sS "$BASE$path")"
  if [[ "$code" != "200" ]]; then
    echo "FAIL $path → HTTP $code" >&2
    exit 1
  fi
  echo "OK   $path → $code"
}

echo "== XinChat desktop update feed ($BASE) =="

check "/xin-desktop-updates/latest.yml"
check "/xin-desktop-updates/latest-linux.yml"

# At least one installer referenced in latest-linux.yml should exist
LINUX_YML="$(mktemp)"
"${CURL[@]}" "$BASE/xin-desktop-updates/latest-linux.yml" -o "$LINUX_YML"
python3 - <<PY
import re, sys
text = open("$LINUX_YML").read()
m = re.search(r"^path:\s*(.+)$", text, re.M)
if not m:
    sys.exit("latest-linux.yml missing path")
path = m.group(1).strip()
print(f"linux artifact: {path}")
PY

ART="$(python3 -c "import re; print(re.search(r'^path:\s*(.+)$', open('$LINUX_YML').read(), re.M).group(1).strip())")"
check "/xin-desktop-updates/$ART"
rm -f "$LINUX_YML"

echo "xin desktop updates smoke complete"
