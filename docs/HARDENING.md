# Qchat Hardening & Launch Checklist

## Security

- [x] Passwords hashed (bcrypt/Argon-equivalent cost); never viewable
- [x] CAPTCHA on login/register
- [x] Same-type device session replacement
- [x] Tenant isolation via enterprise_id on queries
- [x] Admin message access requires reason + audit log
- [x] Electron contextIsolation + sandbox
- [ ] TLS termination (nginx/caddy) in production
- [x] Rotate `QCHAT_JWT_SECRET` — `deploy/rotate-jwt-secret.sh` + `qchat-api.env.example`; production refuses weak default (`QCHAT_ENV=production`)
- [x] Production refuses default LiveKit API key/secret — `ValidateSecrets` + `deploy/check-env.sh` + `render-media-config.sh --strict`
- [x] `deploy/check-env.sh` + LiveKit smoke (`deploy/smoke-livekit.sh`) wired into `redeploy.sh` (`--require-media`)
- [x] Penetration test checklist — `docs/SECURITY_REVIEW.md` (+ MIME allowlist + admin reason length fixes)
- [x] Rate limits at reverse proxy — `deploy/nginx-qchat.conf` (`limit_req` on auth / API / WS)

## Reliability

- [x] Postgres + Redis + NATS + MinIO in docker-compose
- [x] `deploy/backup.sh` / `deploy/restore.sh`
- [x] `deploy/retention.sql` for 90-day purge
- [x] API retention loop + `POST /v1/admin/retention/run` + `PATCH /v1/admin/enterprises/{id}` (`retention_days`)
- [x] `deploy/smoke_test.sh` for auth/messaging path
- [x] Load / reconnect soak: `go run ./cmd/ws_soak -n 1000` (from `services/api`)
  - Working SLO (see `docs/qchat-security-decisions.md`): **p95 first delivery ≤ 1s**, full fan-out p95 ≤ 2s, ≥1k concurrent WS
  - Hot-path hardening: async Redis WS publish, batched push prefs, skip push when WS-online, bounded push/presence workers, larger send buffers, `qchat_ws_send_drops_total` + `qchat_message_publish_duration_seconds`
  - Multi-API-node fan-out still needs Redis (`QCHAT_REDIS_URL`); single-node works in-process without it
  - Multi-user / dual-API soak: `make soak-multi` or `./deploy/soak.sh --multi [--base2 http://127.0.0.1:8081]`
- [x] Restore drill (RPO ≤ 24h, RTO ≤ 4h) — `deploy/restore_drill.sh`, `deploy/cron-backup.example`, `docs/RESTORE_DRILL.md`

## Observability

- Health: `GET /healthz`
- Audit table: `audit_logs`
- Metrics: `GET /metrics` (Prometheus; WS gauge, WS send drops, message publish latency, HTTP latency/errors). Do not expose publicly — nginx returns 404 for `/metrics`.

```bash
# Single seed user, 1k sockets (connection-count proof)
make soak
# or: cd services/api && go run ./cmd/ws_soak -n 1000 -latency-rounds 20 -latency-max 1s -fanout-max 2s

# Distinct users in one group (closer to real concurrency)
make soak-multi
# or: ./deploy/soak.sh --multi

# Cross-node Redis fan-out (run a second API on :8081 sharing Redis)
./deploy/soak.sh --multi --base2 http://127.0.0.1:8081

curl -s localhost:8080/metrics | grep -E 'qchat_ws_|qchat_message_publish'
```

## Acceptance smoke

```bash
cd qchat
docker compose up -d
cd services/api && go run ./cmd/seed && go run ./cmd/api &
bash deploy/smoke_test.sh
```
