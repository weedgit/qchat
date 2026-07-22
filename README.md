# Qchat

Secure enterprise internal messenger with a simple, focused UX.

- **Web first** (Next.js) + Admin console
- **Go** modular monolith API + WebSocket
- Mattermost is reference-only under `../mattermost` (not a fork)

## Quick start

```bash
# Infra (auto-renders LiveKit/coturn for this machine's IP)
make infra-up
# or: ./deploy/render-media-config.sh && set -a && source deploy/generated/media.env && set +a && docker compose up -d

# API (systemd loads deploy/generated/media.env; for go run:)
set -a && source deploy/generated/media.env && set +a
cd services/api && go run ./cmd/api

# Web
cd apps/web && npm install && npm run dev

# Admin
cd apps/admin && npm install && npm run dev

# Desktop (starts web automatically when needed)
cd apps/desktop && npm install && npm run dev
```

- Web: http://localhost:3000
- Admin: http://localhost:3001
- API: http://localhost:8080
- Health: http://localhost:8080/healthz

Desktop development instructions for Linux and Windows 11 are in
[`apps/desktop/README.md`](apps/desktop/README.md).

## Brand assets

Web/PWA, admin, desktop, and mobile icons are generated from
`branding/qchat-icon-512.png`:

```bash
./scripts/sync-brand-icons.sh
```

## Docs

See [`docs/`](docs/) for requirements, architecture decisions, implementation plans, and operational guidance.

For an always-on deployment with the Go API managed by systemd and the web
frontend/API exposed through nginx on port 80, see
[`docs/deployment-nginx-systemd.md`](docs/deployment-nginx-systemd.md).

To pull updates and redeploy on a host:

```bash
./deploy/redeploy.sh
```
