#!/usr/bin/env bash
set -euo pipefail
API="${QCHAT_API:-http://localhost:8080}"

echo "== health =="
curl -sf "$API/healthz" | grep -q '"ok":true'

echo "== captcha =="
CAP=$(curl -sf "$API/v1/auth/captcha")
CID=$(echo "$CAP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["captcha_id"])')
CODE=$(echo "$CAP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["challenge"])')

echo "== login alice =="
TOK=$(curl -sf -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' -d "{
  \"phone\":\"13800000002\",\"password\":\"user12345\",\"invite_code\":\"ACME2026\",
  \"captcha_id\":\"$CID\",\"captcha\":\"$CODE\",\"device_type\":\"desktop\",\"remember_me\":true
}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

echo "== conversations =="
curl -sf "$API/v1/conversations" -H "Authorization: Bearer $TOK" | grep -q conversations

echo "== captcha2 + login bob =="
CAP2=$(curl -sf "$API/v1/auth/captcha")
CID2=$(echo "$CAP2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["captcha_id"])')
CODE2=$(echo "$CAP2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["challenge"])')
TOK2=$(curl -sf -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' -d "{
  \"phone\":\"13800000003\",\"password\":\"user12345\",\"invite_code\":\"ACME2026\",
  \"captcha_id\":\"$CID2\",\"captcha\":\"$CODE2\",\"device_type\":\"desktop\"
}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

BOB=$(curl -sf "$API/v1/me" -H "Authorization: Bearer $TOK2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

echo "== friend request =="
curl -sf -X POST "$API/v1/friends/request" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"username\":\"bob\",\"message\":\"hi\"}" >/dev/null || true

echo "== open dm =="
DM=$(curl -sf -X POST "$API/v1/conversations/dm" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$BOB\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

echo "== send message =="
curl -sf -X POST "$API/v1/conversations/$DM/messages" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"client_msg_id":"smoke-1","body":"hello from smoke test"}' | grep -q '"seq"'

echo "SMOKE OK"
