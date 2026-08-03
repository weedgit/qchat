# Restore drill (RPO ≤ 24h / RTO ≤ 4h)

Customized backup for server failure: Postgres + MinIO + uploads, optional encrypted
secrets bundle, optional off-site rsync, isolated restore drills.

## One-time setup

```bash
# Encryption key (gitignored) — keep a copy off this host
./deploy/backup-init-passphrase.sh

# Off-site directory on another disk/NFS/remote mount (survives host loss)
sudo mkdir -p /var/backups/qchat-offsite
# Optional remote: export QCHAT_BACKUP_OFFSITE=user@backup-host:/var/backups/qchat

# Daily cron + quarterly drill
sudo cp deploy/cron-backup.example /etc/cron.d/qchat-backup
sudo chmod 644 /etc/cron.d/qchat-backup

# Point API admin UI at the same backup root
echo 'QCHAT_BACKUP_DIR=/root/qchat/backups' >> deploy/qchat-api.env
# then restart API
```

## Daily backups (RPO)

```bash
export QCHAT_BACKUP_OFFSITE=/var/backups/qchat-offsite   # recommended
export QCHAT_BACKUP_INCLUDE_SECRETS=1                   # env + TLS certs (encrypted)
./deploy/backup.sh
```

Writes `backups/<UTC>/` with `*.enc` (when passphrase present), `manifest.json`,
updates `backups/latest` + `backups/status.json` (admin **Backup** page).

## Timed restore drill (RTO)

Does **not** overwrite production. Restores into database `qchat_drill`, verifies,
then drops it.

```bash
./deploy/restore_drill.sh
```

Report: `backups/drills/drill-<UTC>.md`

## Production restore after server failure

1. Rebuild host, restore Docker volumes / install stack.
2. Place `deploy/backup.passphrase` and restore secrets if needed.
3. Copy latest backup dir from **off-site**.
4. Confirm overwrite:

```bash
QCHAT_RESTORE_CONFIRM=YES QCHAT_RESTORE_SECRETS=1 ./deploy/restore.sh /path/to/backup-dir
systemctl restart qchat-api
curl -fsS http://127.0.0.1:8080/healthz
```

## Acceptance

| Target | How we meet it |
|---|---|
| RPO ≤ 24h | Cron runs `backup.sh` daily |
| RTO ≤ 4h | `restore_drill.sh` wall clock under 4h |
| Server failure | Off-site copy + encrypted dumps + MinIO archive |
| Operator visibility | Admin → Backup (`GET /v1/admin/backup/status`) |

Requirement review: [`backup-recovery-review.md`](./backup-recovery-review.md).  
Admin UI: [`admin-guide.md`](./admin-guide.md) → Backup & recovery.

Record the latest drill report path in your ops runbook (recommend quarterly; cron example includes it).
