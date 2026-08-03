# Backup & recovery review

**Requirement** ([`requirements-en.md`](./requirements-en.md) §3): provide a customized backup mechanism so data can be restored when the server fails.

**Related ops runbook:** [`RESTORE_DRILL.md`](./RESTORE_DRILL.md)  
**Security target:** RPO ≤ 24h, RTO ≤ 4h ([`qchat-security-decisions.md`](./qchat-security-decisions.md))

## Verdict

**Pass\*** — customized backup/recovery is implemented. Postgres, MinIO, and local uploads are backed up, encrypted when a passphrase is configured, copied off-site when `QCHAT_BACKUP_OFFSITE` is set, exercised by an isolated restore drill, and visible in the admin **Backup** page.

\*Full resilience to total host loss requires keeping the off-site destination on another disk or remote host and storing `deploy/backup.passphrase` off-host.

## Requirement mapping

| Client ask | Implementation | Status |
|---|---|---|
| Customized backup mechanism | `deploy/backup.sh`, `deploy/backup-lib.sh`, `manifest.json` / `status.json` | Pass |
| Restore after server failure | Off-site copy + `deploy/restore.sh` + passphrase / optional secrets | Pass\* |
| Daily encrypted DB + object storage | `pg_dump` + `minio.tar.gz` → `*.enc` (AES-256-CBC) | Pass |
| RPO ≤ 24h / RTO ≤ 4h | Daily cron + `deploy/restore_drill.sh` (isolated `qchat_drill`) | Pass |
| Admin backup / DR status (§5) | `GET /v1/admin/backup/status` + Admin → **Backup** | Pass |

## What is covered

| Component | In backup? | Notes |
|---|---|---|
| Postgres (`qchat`) | Yes — `qchat.dump` / `.enc` | Primary app data |
| MinIO volume | Yes — `minio.tar.gz` / `.enc` | Chat media / avatars |
| Local uploads dir | Yes if present | Legacy / fallback |
| `deploy/qchat-api.env` + TLS certs | Optional (`QCHAT_BACKUP_INCLUDE_SECRETS=1`) | Encrypted with same passphrase |
| Redis | No | Ephemeral (sessions / fan-out); re-login after restore |
| LiveKit / NATS | No | Rebuildable |

## Scripts and artifacts

| Path | Role |
|---|---|
| `deploy/backup-init-passphrase.sh` | Create gitignored `deploy/backup.passphrase` |
| `deploy/backup.sh` | Produce stamped backup dir + update `latest` / `status.json` |
| `deploy/restore.sh` | Restore; production DB needs `QCHAT_RESTORE_CONFIRM=YES` |
| `deploy/restore_drill.sh` | Backup → restore into `qchat_drill` → verify → drop (does not touch production) |
| `deploy/cron-backup.example` | Daily backup + quarterly drill |
| `backups/<UTC>/` | Dump artifacts + `manifest.json` |
| `backups/status.json` | Admin / API DR status |
| `backups/drills/drill-*.md` | Timed drill reports |

## Operator checklist

1. Run `./deploy/backup-init-passphrase.sh` and keep a copy of the passphrase **off this host**.
2. Set `QCHAT_BACKUP_OFFSITE` (e.g. `/var/backups/qchat-offsite` or `user@host:/path`) and ensure it stays mounted.
3. Install cron from `deploy/cron-backup.example`.
4. Set `QCHAT_BACKUP_DIR` in `deploy/qchat-api.env` so the admin UI can read status; restart API.
5. Run `./deploy/restore_drill.sh` after major changes; keep the report path in the ops runbook.

## Residual risks

| Item | Notes |
|---|---|
| Off-site on the same machine | Better than repo disk alone; prefer a remote host for true DR |
| Secrets in backup | Cron example may set `QCHAT_BACKUP_INCLUDE_SECRETS=1`; protect the passphrase |
| Production restore confirm | Accidental overwrite is blocked unless `QCHAT_RESTORE_CONFIRM=YES` |

## How to operate day-to-day

See **[`RESTORE_DRILL.md`](./RESTORE_DRILL.md)** for setup, daily backup, drill, and production restore commands.  
Admin operators: **[`admin-guide.md`](./admin-guide.md)** → Backup & recovery section.
