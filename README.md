# Qchat

Secure enterprise internal messenger with a simple, focused UX.

- **Web first** (Next.js) + Admin console
- **Go** modular monolith API + WebSocket
- Mattermost is reference-only under `../mattermost` (not a fork)

## Quick start

```bash
# Infra
docker compose up -d postgres redis minio nats

# API
cd services/api && go run ./cmd/api

# Web
cd apps/web && npm install && npm run dev

# Admin
cd apps/admin && npm install && npm run dev
```

- Web: http://localhost:3000
- Admin: http://localhost:3001
- API: http://localhost:8080
- Health: http://localhost:8080/healthz

## Docs

See [`docs/`](docs/) for requirements, architecture decisions, implementation plans, and operational guidance.
