# Restore drill (RPO ≤ 24h / RTO ≤ 4h)

Prove backups work by timing a real restore, not just writing scripts.

## Prerequisites

- Docker Compose Postgres is up
- API can be restarted after restore (optional but healthz is checked)
- Enough disk under `qchat/backups/`

## Daily backups (RPO)

```bash
sudo cp deploy/cron-backup.example /etc/cron.d/qchat-backup
# edit path/user if not /root/qchat
sudo chmod 644 /etc/cron.d/qchat-backup
```

Manual:

```bash
./deploy/backup.sh
```

## Timed restore drill (RTO)

With API listening on `:8080` (or expect healthz FAIL noted in the report):

```bash
./deploy/restore_drill.sh
```

Writes `backups/drills/drill-<UTC>.md` with backup seconds, restore seconds, and pass/fail vs the 4h RTO budget.

## Acceptance

| Target | How we meet it |
|---|---|
| RPO ≤ 24h | Cron runs `backup.sh` at least daily |
| RTO ≤ 4h | `restore_drill.sh` wall clock must stay under 4h (local drills are typically minutes) |

Record the latest drill report path in your ops runbook after each scheduled exercise (recommend quarterly).
