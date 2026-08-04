# XinChat clients

XinChat is a second branded client for the same Qchat/Rchat backend API.

| App | Path | URL (production) |
|-----|------|------------------|
| Web | `apps/xin-web` | `https://<host>/xin/` |
| Mobile | `apps/xin-mobile` | Store listing (bundle `com.xinchat.mobile`) |
| Desktop | `apps/xin-desktop` | Electron shell loading `/xin/` |

## Layout (Xin skin)

Distinct from Rchat (Telegram-style flat blue): **plum/fuchsia** palette, **DM Sans** typography, labeled nav rail with **XinChat** wordmark, floating card panels, squircle avatars, square violet FAB, split login hero, gradient message bubbles.

- **Web:** `src/app/xin-layout.css` + `globals.css` tokens under `data-app="xinchat"`
- **Mobile:** pill tab bar with accent border, fuchsia-violet `src/theme.ts`


Violet **X** icons are generated from `scripts/generate-xinchat-icons.py` (web, mobile, desktop).

```bash
python3 scripts/generate-xinchat-icons.py
cd apps/xin-desktop && node scripts/build-icon-ico.js
./deploy/redeploy.sh --xin-web --skip-env-check
```

## Mobile store release

See also: [docs/xinchat-mobile-release.md](../docs/xinchat-mobile-release.md), [docs/xinchat-release-status.md](../docs/xinchat-release-status.md).

Store checklist: [docs/xinchat-store-submit.md](../docs/xinchat-store-submit.md)

CI: `.github/workflows/xin-mobile.yml`

## Desktop / mobile installers

Download page: `https://<host>/xin/download`

```bash
# After building desktop (npm run dist) or EAS APK:
make publish-xin                  # sync + redeploy xin-web
make publish-xin-linux            # build Linux desktop + sync + redeploy

# Or manually:
./scripts/eas-pull-xin-apk.sh preview   # after EAS build
./scripts/publish-xin-release.sh --skip-dist
```

Desktop auto-update feed: `https://<host>/xin-desktop-updates/`

```bash
make sync-xin-desktop-updates DEST=/var/www/xin-desktop-updates
# or: make publish-xin-full
```

Details: [docs/xinchat-desktop-release.md](../docs/xinchat-desktop-release.md)

## Optional subdomain

`deploy/nginx-xinchat-subdomain.conf.example` — host Xin on `xin.example.com` (redirects to `/xin/`).


## Web

```bash
cd apps/xin-web
npm ci
npm run dev    # http://localhost:3001/xin/
npm run build  # static export → out/ (served at /xin/)
```

Deploy with the main script:

```bash
./deploy/redeploy.sh --xin-web
```

## Mobile

Separate App Store / Play Store listing from Rchat. Configure EAS and push credentials for `com.xinchat.mobile`.

```bash
cd apps/xin-mobile
npm ci
npx expo start
```

## Desktop

```bash
cd apps/xin-desktop
npm ci
npm run dev          # starts xin-web + Electron
npm run start:server # packaged against https://<host>/xin
```

## Shared backend

All XinChat apps use the same `/v1/` API, WebSocket, and LiveKit stack as Rchat. Auth tokens are stored under separate keys (`xinchat.*`) so both web clients can coexist on one domain without session clashes.
