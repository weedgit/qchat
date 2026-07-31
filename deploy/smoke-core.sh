#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://localhost:8080}"

login() {
  local phone="$1" pass="$2"
  local cap cid ans
  cap=$(curl -sS "$API/v1/auth/captcha")
  cid=$(echo "$cap" | python3 -c 'import sys,json; print(json.load(sys.stdin)["captcha_id"])')
  ans=$(echo "$cap" | python3 -c 'import sys,json; print(json.load(sys.stdin)["challenge"])')
  curl -sS -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"password\":\"$pass\",\"invite_code\":\"ACME2026\",\"captcha_id\":\"$cid\",\"captcha\":\"$ans\",\"device_type\":\"web\",\"remember_me\":true}"
}

echo "== refresh rotation =="
ALICE=$(login 13800000002 user12345)
AT=$(echo "$ALICE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
RT=$(echo "$ALICE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["refresh_token"])')
NEW=$(curl -sS -X POST "$API/v1/auth/refresh" -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$RT\"}")
echo "$NEW" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("access_token"); print("refresh ok")'

echo "== friends lookup =="
curl -sS "$API/v1/users/lookup?q=bob" -H "Authorization: Bearer $AT" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(u["username"]=="bob" for u in d.get("users",[])); print("lookup ok")'

echo "== phone change =="
PHONE="137$(date +%s | tail -c 9)"
CH=$(curl -sS -X PUT "$API/v1/me/phone" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"new_phone\":\"$PHONE\",\"password\":\"user12345\"}")
echo "$CH" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("ok") and d.get("phone"), d; print("phone change ok", d["phone"])'
# restore original demo phone so later smokes keep working
curl -sS -X PUT "$API/v1/me/phone" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"new_phone":"13800000002","password":"user12345"}' >/dev/null

echo "== group create =="
BOB=$(login 13800000003 user12345)
BT=$(echo "$BOB" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
BID=$(curl -sS "$API/v1/me" -H "Authorization: Bearer $BT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
# ensure friendship
curl -sS -X PATCH "$API/v1/me" -H "Authorization: Bearer $BT" -H 'Content-Type: application/json' -d '{"friend_privacy":"open"}' >/dev/null
curl -sS -X POST "$API/v1/friends/request" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"username":"bob"}' >/dev/null
G=$(curl -sS -X POST "$API/v1/groups" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Smoke Group\",\"member_ids\":[\"$BID\"]}")
GID=$(echo "$G" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("id"), d; print(d["id"])')
MSG=$(curl -sS -X POST "$API/v1/conversations/$GID/messages" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d '{"type":"text","body":"group hi","client_msg_id":"smoke-g1"}')
MID=$(echo "$MSG" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -sS -X POST "$API/v1/messages/$MID/recall" -H "Authorization: Bearer $AT" >/dev/null
# owner sees recall; member does not
python3 - <<PY
import json,urllib.request
api="$API"; at="$AT"; bt="$BT"; gid="$GID"; mid="$MID"
def get(tok):
  req=urllib.request.Request(f"{api}/v1/conversations/{gid}/messages", headers={"Authorization":f"Bearer {tok}"})
  return json.load(urllib.request.urlopen(req))["messages"]
owner=[m for m in get(at) if m["id"]==mid]
member=[m for m in get(bt) if m["id"]==mid]
assert owner and owner[0].get("recalled") is True, owner
assert not member, member
print("group recall visibility ok")
PY

echo "SMOKE_CORE_OK"
