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
| 6 Desktop / mobile / calls | Partial | Web 1:1 LiveKit voice/video done (`/v1/calls*`, LiveKit server **v1.9.12** + coturn TURN in `deploy/livekit.yaml`); desktop/mobile still scaffolded |
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
docker compose up -d   # includes LiveKit on :7880
cd services/api && go run ./cmd/seed && go run ./cmd/api
# optional LiveKit env (defaults match deploy/livekit.yaml):
#   LIVEKIT_URL=ws://localhost:7880
#   LIVEKIT_API_KEY=devkey
#   LIVEKIT_API_SECRET=secret-that-is-at-least-32-characters-long
# other terminals
cd apps/web && npm run dev
# Admin static export (served at https://<host>/admin/ after nginx reload):
#   cd apps/admin && NEXT_PUBLIC_API_URL= npm run build
# Dev without nginx: make admin-dev  (http://localhost:3001/admin)
bash deploy/smoke_test.sh
```
