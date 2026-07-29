# Qchat

Secure enterprise internal messenger with a simple, focused UX.

- **Web first** (Next.js) + Admin console
- **Go** modular monolith API + WebSocket

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

## Deploy modes

Qchat can run on a **VPS** or on a **local LAN computer** (no VPS):

| Mode | Host | Desktop command |
|---|---|---|
| **A — VPS** | nginx + HTTPS (e.g. `135.181.224.36`) | `cd apps/desktop && npm run start:server` |
| **B — Local / LAN** | PC or Ubuntu VM (e.g. `192.168.1.124:3000`) | `cd apps/desktop && npm run start:lan` / `start:ubuntu` |

See [`docs/deployment-modes.md`](docs/deployment-modes.md) for both setups.
VPS nginx details: [`docs/deployment-nginx-systemd.md`](docs/deployment-nginx-systemd.md).

## Brand assets

Web/PWA, admin, desktop, and mobile icons are generated from
`branding/qchat-icon-512.png`:

```bash
./scripts/sync-brand-icons.sh
```

## Docs

See [`docs/`](docs/) for requirements, architecture decisions, implementation plans, and operational guidance.

- **End-user & admin guide:** [`docs/user-guide.md`](docs/user-guide.md)
- **Security implementation:** [`docs/security-implementation.md`](docs/security-implementation.md)
- Dual deploy (VPS vs LAN): [`docs/deployment-modes.md`](docs/deployment-modes.md)
- Always-on VPS with systemd + nginx: [`docs/deployment-nginx-systemd.md`](docs/deployment-nginx-systemd.md)

### Client downloads (web)

After building desktop/mobile installers, copy them into
`apps/web/public/downloads/` and set `"available": true` in
`manifest.json` (helper: `./scripts/publish-downloads.sh`).
Users open **Download** on the login page → `/download`.

To pull updates and redeploy on a host:

```bash
./deploy/redeploy.sh
```
