# XinChat desktop release

XinChat desktop is an Electron shell loading **`https://<host>/xin/`** (bundle `com.xinchat.desktop`). It shares the same API as Rchat but uses a separate auto-update feed.

## Paths

| Item | URL / path |
|------|------------|
| Web client | `https://<host>/xin/` |
| Download page | `https://<host>/xin/download` |
| Auto-update feed | `https://<host>/xin-desktop-updates/` → `/var/www/xin-desktop-updates/` |

## One-time host setup

```bash
./deploy/setup-xin-release.sh
sudo systemctl reload nginx
```

`production.json` in `apps/xin-desktop` sets `webUrl` and `updateUrl` for packaged builds. Override per machine via userData `config.json` if needed.

## Local dev

```bash
make xin-desktop          # Electron + xin-web on :3001/xin
cd apps/xin-desktop && npm run start:server   # against production /xin URL
```

## Build installers

```bash
cd apps/xin-desktop
npm ci
npm run check

# Linux (on Linux host)
npm run dist:linux          # AppImage only (recommended on VPS)
npm run dist:linux:deb      # needs binutils (`ar`)
npm run dist:linux:full     # AppImage + deb

# Windows on Linux host
npm run dist:win:docker

# macOS (on macOS)
npm run dist:mac
```

Artifacts land in `apps/xin-desktop/dist/` with names like `xinchat-desktop-0.1.0-x64.AppImage`.

## Publish to the download page

Copy builds into the static site and redeploy:

```bash
# Sync whatever exists in dist/ + apps/xin-mobile/build.apk
./scripts/sync-xin-installers.sh
./deploy/redeploy.sh --xin-web --sync-xin-installers --skip-env-check

# Or one command (optional Linux build + sync + redeploy):
./scripts/publish-xin-release.sh --linux-dist
```

## Desktop auto-update

Generate `latest-linux.yml` (and blockmap) when publishing the feed:

```bash
cd apps/xin-desktop
npm run dist:linux:publish
make sync-xin-desktop-updates DEST=/var/www/xin-desktop-updates
```

After `dist:*`, publish artifacts to the nginx alias:

```bash
sudo ./scripts/sync-xin-desktop-updates.sh
# or: make sync-xin-desktop-updates DEST=/var/www/xin-desktop-updates
sudo nginx -t && sudo systemctl reload nginx
```

Or copy manually:

```bash
sudo rsync -a apps/xin-desktop/dist/latest*.yml \
  apps/xin-desktop/dist/xinchat-desktop*.{AppImage,deb,exe,dmg} \
  /var/www/xin-desktop-updates/
sudo nginx -t && sudo systemctl reload nginx
```

Packaged clients poll `updateUrl` from `production.json` (default `https://<host>/xin-desktop-updates`).

## Icons

```bash
make xin-icons
```

See also: [XINCHAT.md](../apps/XINCHAT.md), [deployment-nginx-systemd.md](./deployment-nginx-systemd.md).
