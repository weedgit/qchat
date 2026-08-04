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

## XinChat (second branded client)

Same API and enterprises as Rchat; separate web/mobile/desktop apps and store listings.

| Client | URL / path | Folder |
|--------|------------|--------|
| XinChat web | `https://<host>/xin/` | `apps/xin-web` |
| XinChat mobile | `com.xinchat.mobile` | `apps/xin-mobile` |
| XinChat desktop | loads `/xin/` | `apps/xin-desktop` |

```bash
make xin-web                              # dev http://localhost:3001/xin/
make xin-mobile                           # Expo dev
make xin-desktop                          # Electron dev
make xin-icons                            # regenerate violet X assets
make xin-redeploy                         # build xin-web + reload nginx
make setup-xin                            # host dirs for xin-desktop-updates
make sync-xin-installers                  # copy APK/dist into xin-web downloads
make publish-xin                          # sync installers + redeploy xin-web
make publish-xin-linux                    # Linux desktop build + publish
make xin-desktop-dist-win-docker          # Windows .exe via Docker
make sync-xin-desktop-updates             # dist/ → /var/www/xin-desktop-updates/
make publish-xin-full                    # update feed + downloads + redeploy + smoke
make xin-mobile-bootstrap                # local dev .env + checks (no EAS)
make xin-mobile-eas-onboard              # EAS login/init helper
make wait-eas-xin-apk                    # poll EAS → publish APK (needs EXPO_TOKEN)
```

Details: [`apps/XINCHAT.md`](apps/XINCHAT.md)

One-command full publish (desktop feed + downloads + redeploy):

```bash
make publish-xin-full
```

Details: [`apps/XINCHAT.md`](apps/XINCHAT.md) · [`docs/xinchat-release-status.md`](docs/xinchat-release-status.md)

Store submit checklist: [`docs/xinchat-store-submit.md`](docs/xinchat-store-submit.md)

## Brand assets

Web/PWA, admin, desktop, and mobile icons are generated from
`branding/qchat-icon-512.png`:

```bash
./scripts/sync-brand-icons.sh
./scripts/generate-xinchat-icons.sh   # XinChat violet X icons
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
