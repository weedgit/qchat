#!/usr/bin/env bash
# Static + nginx smoke for XinChat paths on the same host as Rchat.
set -euo pipefail

BASE="${BASE:-https://127.0.0.1}"
CURL=(curl -kfsS --retry 2 --retry-delay 1)

check() {
  local path="$1"
  local expect="${2:-200}"
  local code
  code="$(curl -k -o /dev/null -w '%{http_code}' -sS "$BASE$path")"
  if [[ "$code" != "$expect" ]]; then
    echo "FAIL $path → HTTP $code (expected $expect)" >&2
    exit 1
  fi
  echo "OK   $path → $code"
}

echo "== XinChat static smoke ($BASE) =="

check "/xin/"
check "/xin/login"
check "/xin/download"
check "/xin/manifest.webmanifest"
check "/xin/icons/icon-192.png"

MANIFEST="$(mktemp)"
"${CURL[@]}" "$BASE/xin/downloads/manifest.json" -o "$MANIFEST"
python3 - <<PY
import json, sys
with open("$MANIFEST") as f:
    d = json.load(f)
apps = d.get("apps") or []
assert isinstance(apps, list) and apps, "manifest.apps empty"
for a in apps:
    assert a.get("id"), a
print(f"manifest ok ({len(apps)} apps)")
PY
rm -f "$MANIFEST"

python3 - <<PY
import json,ssl,urllib.request
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
base = "$BASE"
with urllib.request.urlopen(f"{base}/xin/downloads/manifest.json", context=ctx) as r:
    d = json.load(r)
linux = next(a for a in d.get("apps", []) if a.get("id") == "linux-appimage")
assert linux.get("available"), linux
fp = linux.get("file")
with urllib.request.urlopen(f"{base}/xin/downloads/{fp}", context=ctx) as r:
    assert r.status == 200
print(f"download asset ok: {fp}")
win = next((a for a in d.get("apps", []) if a.get("id") == "windows"), None)
if win and win.get("available") and win.get("file"):
    wfp = win["file"]
    with urllib.request.urlopen(f"{base}/xin/downloads/{wfp}", context=ctx) as r:
        assert r.status == 200
    print(f"download asset ok: {wfp}")
PY

echo "xin smoke complete"
