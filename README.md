# Qchat

Secure enterprise internal messenger with a simple, focused UX.

- **Web first** (Next.js) + Admin console
- **Go** modular monolith API + WebSocket
- **Rchat** (primary web at `/`) and **XinChat** (second brand at `/xin/`) — same API and accounts

## Quick start

```bash
# Infra (auto-renders LiveKit/coturn for this machine's IP)
make infra-up

# API (systemd loads deploy/generated/media.env; for go run:)
set -a && source deploy/generated/media.env && set +a
cd services/api && go run ./cmd/api

# Web (Rchat)
cd apps/web && npm install && npm run dev

# Admin
cd apps/admin && npm install && npm run dev

# Desktop (starts web automatically when needed)
cd apps/desktop && npm install && npm run dev
```

| Service | URL |
|---------|-----|
| Rchat web | http://localhost:3000 |
| XinChat web | http://localhost:3001/xin/ (`make xin-web`) |
| Admin | http://localhost:3001 |
| API | http://localhost:8080 |

Desktop development: [`apps/desktop/README.md`](apps/desktop/README.md).

## Public hosts (domains)

Edit **`deploy/hosts.env`** (copy from `deploy/hosts.env.example`), then sync all apps:

```bash
cp deploy/hosts.env.example deploy/hosts.env   # first time only
# edit deploy/hosts.env — set RCHAT_ORIGIN, XINCHAT_ORIGIN, etc.
make sync-hosts
```

That writes each app's `.env` and desktop `production.json`. **You do not need the VPS IP in code** — use HTTPS domains; the IP is only commented in `hosts.env` as a fallback.

## Deploy modes

| Mode | Host | Desktop command |
|------|------|-----------------|
| **Production** | `rchat.boostbunny.io` / `xinchat.boostbunny.io` | `npm run start:server` (reads `.env`) |
| **LAN** | PC or VM (e.g. `192.168.1.124:3000`) | `npm run start:lan` |

See [`docs/deployment-modes.md`](docs/deployment-modes.md) and [`docs/deployment-nginx-systemd.md`](docs/deployment-nginx-systemd.md).

## XinChat (second branded client)

Same API and user accounts as Rchat; separate apps and store listings.

| Client | URL / path | Folder |
|--------|------------|--------|
| XinChat web | `https://<host>/xin/` | `apps/xin-web` |
| XinChat mobile | `com.xinchat.mobile` | `apps/xin-mobile` |
| XinChat desktop | loads `/xin/` | `apps/xin-desktop` |

```bash
make xin-web
make xin-mobile
make xin-desktop
make xin-icons
make publish-xin-full          # installers + auto-update + redeploy
```

Details: [`apps/XINCHAT.md`](apps/XINCHAT.md) · [`docs/xinchat-release.md`](docs/xinchat-release.md)

## Brand assets

```bash
./scripts/sync-brand-icons.sh           # Rchat icons from branding/qchat-icon-512.png
./scripts/generate-xinchat-icons.sh     # XinChat green X icons
```

## Docs

Index: [`docs/README.md`](docs/README.md)

| Topic | Doc |
|-------|-----|
| User guide | [`docs/user-guide.md`](docs/user-guide.md) |
| Admin guide | [`docs/admin-guide.md`](docs/admin-guide.md) |
| Security | [`docs/security-implementation.md`](docs/security-implementation.md) |
| Mobile (Rchat) | [`docs/mobile-release.md`](docs/mobile-release.md) |
| XinChat release | [`docs/xinchat-release.md`](docs/xinchat-release.md) |

## Client downloads (web)

Built installers live on the deploy host under `apps/web/public/downloads/` and `apps/xin-web/public/downloads/` — **not** in git (see `.gitignore`). Sync with `./scripts/publish-downloads.sh` or `./scripts/sync-xin-installers.sh`, then redeploy.

```bash
./deploy/redeploy.sh
./deploy/redeploy.sh --xin-web --sync-xin-installers --skip-env-check
```

## Project status (summary)

| Area | Status |
|------|--------|
| API (auth, DM, groups, WS, media, admin) | Shipped |
| Rchat web + admin | Shipped |
| XinChat web / mobile / desktop clients | Shipped (green UI) |
| LiveKit 1:1 calls | Shipped |
| Desktop shell (Rchat + XinChat) | Shipped (Electron + auto-update) |
| Mobile store listings | EAS-ready; publish per [`docs/mobile-release.md`](docs/mobile-release.md) / [`docs/xinchat-release.md`](docs/xinchat-release.md) |

Seed accounts: see `services/api` seed or [`docs/user-guide.md`](docs/user-guide.md).
