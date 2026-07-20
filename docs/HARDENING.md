# Qchat Hardening & Launch Checklist

## Security

- [x] Passwords hashed (bcrypt/Argon-equivalent cost); never viewable
- [x] CAPTCHA on login/register
- [x] Same-type device session replacement
- [x] Tenant isolation via enterprise_id on queries
- [x] Admin message access requires reason + audit log
- [x] Electron contextIsolation + sandbox
- [ ] TLS termination (nginx/caddy) in production
- [ ] Rotate `QCHAT_JWT_SECRET`
- [ ] Penetration test before public launch
- [ ] Rate limits at reverse proxy

## Reliability

- [x] Postgres + Redis + NATS + MinIO in docker-compose
- [x] `deploy/backup.sh` / `deploy/restore.sh`
- [x] `deploy/retention.sql` for 90-day purge
- [x] API retention loop + `POST /v1/admin/retention/run` + `PATCH /v1/admin/enterprises/{id}` (`retention_days`)
- [x] `deploy/smoke_test.sh` for auth/messaging path
- [ ] Load test ≥ 1000 WS connections
- [ ] Restore drill (RPO ≤ 24h, RTO ≤ 4h)

## Observability

- Health: `GET /healthz`
- Audit table: `audit_logs`
- Add Prometheus metrics in Phase 7 productionization

## Acceptance smoke

```bash
cd qchat
docker compose up -d
cd services/api && go run ./cmd/seed && go run ./cmd/api &
bash deploy/smoke_test.sh
```
