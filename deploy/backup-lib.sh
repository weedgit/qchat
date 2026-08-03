#!/usr/bin/env bash
# Shared helpers for backup.sh / restore.sh / restore_drill.sh
# shellcheck disable=SC2034

backup_root() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "${QCHAT_BACKUP_DIR:-$root/backups}"
}

compose_project() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "${COMPOSE_PROJECT_NAME:-$(basename "$root")}"
}

# docker-compose.yml interpolates LIVEKIT_NODE_IP even for unrelated services.
ensure_compose_env() {
  local root media
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  media="$root/deploy/generated/media.env"
  if [[ -f "$media" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$media" || true
    set +a
  fi
  export LIVEKIT_NODE_IP="${LIVEKIT_NODE_IP:-127.0.0.1}"
}

compose() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  ensure_compose_env
  docker compose -f "$root/docker-compose.yml" "$@"
}

minio_volume_name() {
  local proj want
  proj="$(compose_project)"
  want="${proj}_qchat_minio"
  if docker volume inspect "$want" >/dev/null 2>&1; then
    echo "$want"
    return 0
  fi
  # Fallback: any volume ending in _qchat_minio
  docker volume ls -q 2>/dev/null | grep '_qchat_minio$' | head -1 || true
}

passphrase_file() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "${QCHAT_BACKUP_PASSPHRASE_FILE:-$root/deploy/backup.passphrase}"
}

passphrase_available() {
  if [[ -n "${QCHAT_BACKUP_PASSPHRASE:-}" ]]; then
    return 0
  fi
  local f
  f="$(passphrase_file)"
  [[ -f "$f" && -s "$f" ]]
}

# Print passphrase to stdout (caller must not log).
read_passphrase() {
  if [[ -n "${QCHAT_BACKUP_PASSPHRASE:-}" ]]; then
    printf '%s' "$QCHAT_BACKUP_PASSPHRASE"
    return 0
  fi
  local f
  f="$(passphrase_file)"
  if [[ -f "$f" ]]; then
    # trim trailing newline
    tr -d '\n' < "$f"
    return 0
  fi
  return 1
}

encrypt_file() {
  local src="$1" dest="$2"
  local pass
  pass="$(read_passphrase)"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$src" -out "$dest" -pass "pass:${pass}"
}

decrypt_file() {
  local src="$1" dest="$2"
  local pass
  pass="$(read_passphrase)"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$src" -out "$dest" -pass "pass:${pass}"
}

shred_or_rm() {
  local f="$1"
  if command -v shred >/dev/null 2>&1; then
    shred -u "$f" 2>/dev/null || rm -f "$f"
  else
    rm -f "$f"
  fi
}

# Resolve artifact path: prefer .enc when present.
resolve_artifact() {
  local dir="$1" name="$2"
  if [[ -f "$dir/${name}.enc" ]]; then
    echo "$dir/${name}.enc"
  elif [[ -f "$dir/$name" ]]; then
    echo "$dir/$name"
  else
    return 1
  fi
}

# Decrypt artifact to a temp path if needed; prints plaintext path.
# Caller should rm temp when done if it differs from source.
materialize_artifact() {
  local dir="$1" name="$2"
  local src
  src="$(resolve_artifact "$dir" "$name")" || return 1
  if [[ "$src" == *.enc ]]; then
    if ! passphrase_available; then
      echo "encrypted $name requires passphrase" >&2
      return 1
    fi
    local tmp
    tmp="$(mktemp "$dir/.${name}.XXXXXX")"
    decrypt_file "$src" "$tmp"
    echo "$tmp"
  else
    echo "$src"
  fi
}

write_status_json() {
  local backup_root="$1" stamp="$2" out="$3" encrypted="$4" errors="$5"
  shift 5
  local comps=("$@")
  local status="$backup_root/status.json"
  python3 - "$status" "$stamp" "$out" "$encrypted" "$errors" "${comps[@]}" <<'PY'
import json, sys, os, time
status, stamp, out, enc, errors = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "True", int(sys.argv[5])
comps = sys.argv[6:]
age_ok = True
payload = {
  "schema": 1,
  "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "latest": {
    "id": stamp,
    "path": out,
    "created_at": stamp,
    "encrypted": enc,
    "errors": errors,
    "components": comps,
    "rpo_hours": 24,
    "rto_hours": 4,
  },
  "offsite_configured": bool(os.environ.get("QCHAT_BACKUP_OFFSITE")),
  "encryption_configured": enc or bool(os.environ.get("QCHAT_BACKUP_PASSPHRASE")) or os.path.isfile(
    os.environ.get("QCHAT_BACKUP_PASSPHRASE_FILE", "")
  ),
}
# List recent backups
root = os.path.dirname(status)
recent = []
if os.path.isdir(root):
  dirs = sorted(
    [d for d in os.listdir(root) if d[:1].isdigit() and os.path.isdir(os.path.join(root, d))],
    reverse=True,
  )[:10]
  for d in dirs:
    mpath = os.path.join(root, d, "manifest.json")
    entry = {"id": d, "path": os.path.join(root, d)}
    if os.path.isfile(mpath):
      try:
        with open(mpath) as f:
          entry["manifest"] = json.load(f)
      except Exception:
        pass
    recent.append(entry)
payload["recent"] = recent

# Latest drill report
drill_dir = os.path.join(root, "drills")
if os.path.isdir(drill_dir):
  drills = sorted([f for f in os.listdir(drill_dir) if f.startswith("drill-") and f.endswith(".md")], reverse=True)
  if drills:
    latest_drill = os.path.join(drill_dir, drills[0])
    text = open(latest_drill, encoding="utf-8", errors="replace").read()
    ok = "DRILL OK" in text
    failed = "DRILL FAILED" in text
    payload["latest_drill"] = {
      "path": latest_drill,
      "id": drills[0],
      "ok": ok and not failed,
      "excerpt": "\n".join(text.strip().splitlines()[-12:]),
    }

with open(status, "w") as f:
  json.dump(payload, f, indent=2)
  f.write("\n")
PY
}
