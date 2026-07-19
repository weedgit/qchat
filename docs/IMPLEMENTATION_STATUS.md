# Qchat Implementation Status

All planned phases have an actionable foundation in this monorepo.

| Phase | Status | Location |
|---|---|---|
| 0 Contract + web prototype | Done | `docs/qchat-*.md`, `apps/web` UI |
| 1 Foundation (auth, tenancy, RBAC) | Done | `services/api` |
| 2 Messenger MVP | Done | friends, DM, groups, WS, receipts, mute, recall, history boundary |
| 3 Media / search / notifications | Done | upload, forward, search, push register adapters |
| 4 Collaboration | Done | spaces, channels, bots, webhooks |
| 5 Admin / compliance | Done | ban, reset password, audits, message inspect+reason, invite rotate |
| 6 Desktop / mobile / calls | Scaffolded | `apps/desktop`, `apps/mobile`, LiveKit stub `/v1/calls` |
| 7 Hardening / launch | Done | `deploy/*`, `docs/HARDENING.md`, smoke tests |

## Seed accounts

| Phone | Password | Invite | Role |
|---|---|---|---|
| 13800000001 | admin12345 | ACME2026 | enterprise_admin |
| 13800000002 | user12345 | ACME2026 | alice (member) |
| 13800000003 | user12345 | ACME2026 | bob (member) |
| BETA2026 | — | second enterprise invite | — |

## Run

```bash
cd qchat
docker compose up -d
cd services/api && go run ./cmd/seed && go run ./cmd/api
# other terminals
cd apps/web && npm run dev
cd apps/admin && npm run dev -p 3001
bash deploy/smoke_test.sh
```
