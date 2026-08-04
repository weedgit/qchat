# XinChat Desktop (Electron)

Thin Electron shell loading **`https://<host>/xin/`** (bundle `com.xinchat.desktop`). Same main/preload/shared layout as Rchat desktop; see [`apps/desktop/README.md`](../desktop/README.md) for shared Electron dev notes (sandbox, LiveKit, Windows/Linux setup).

## Quick start

```bash
# API + infra (from repo root)
make infra-up
cd services/api && go run ./cmd/api

# Dev — starts xin-web + Electron
cd apps/xin-desktop
npm ci
npm run dev              # http://localhost:3001/xin/
npm run start:server     # packaged URL from production.json
```

`production.json` sets default `webUrl` and `updateUrl` (`/xin-desktop-updates`). Override per machine in userData `config.json`.

## Build & publish

```bash
npm run dist:linux       # AppImage
npm run dist:win:docker  # Windows .exe on Linux host
npm run dist:mac         # macOS only
```

Release pipeline: [`docs/xinchat-release.md`](../../docs/xinchat-release.md).

## Branding

Desktop injects `assets/chat-layout-override.css` (emerald tokens matching `apps/xin-web`). Splash: `assets/splash.html`. Icons: `make xin-icons` from repo root.
