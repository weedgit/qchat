#!/usr/bin/env bash
# Rotate QCHAT_JWT_SECRET in deploy/qchat-api.env (secret rotation).
# Invalidates all existing access/refresh tokens — expected after rotation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${QCHAT_ENV_FILE:-$ROOT/deploy/qchat-api.env}"
EXAMPLE="$ROOT/deploy/qchat-api.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$ENV_FILE"
    echo "Created $ENV_FILE from example"
  else
    echo "error: missing $ENV_FILE and $EXAMPLE" >&2
    exit 1
  fi
fi

NEW="$(openssl rand -base64 48 | tr -d '\n')"
if grep -q '^QCHAT_JWT_SECRET=' "$ENV_FILE"; then
  # Portable in-place edit without leaking secret into process list via sed args alone
  tmp="$(mktemp)"
  awk -v secret="$NEW" '
    BEGIN { done=0 }
    /^QCHAT_JWT_SECRET=/ {
      print "QCHAT_JWT_SECRET=" secret
      done=1
      next
    }
    { print }
    END {
      if (!done) print "QCHAT_JWT_SECRET=" secret
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
else
  printf '\nQCHAT_JWT_SECRET=%s\n' "$NEW" >> "$ENV_FILE"
fi

chmod 600 "$ENV_FILE" 2>/dev/null || true
echo "Rotated QCHAT_JWT_SECRET in $ENV_FILE"
echo "Restart the API to apply (sessions will invalidate):"
echo "  systemctl restart qchat-api   # or: go run ./cmd/api with EnvironmentFile"
