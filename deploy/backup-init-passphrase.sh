#!/usr/bin/env bash
# Initialize deploy/backup.passphrase for AES-encrypted backups (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${QCHAT_BACKUP_PASSPHRASE_FILE:-$ROOT/deploy/backup.passphrase}"
if [[ -f "$FILE" && -s "$FILE" && "${1:-}" != "--force" ]]; then
  echo "Already exists: $FILE (use --force to rotate)"
  exit 0
fi
umask 077
openssl rand -base64 32 > "$FILE"
chmod 600 "$FILE"
echo "Wrote $FILE — store a copy off-host; required to decrypt backups."
