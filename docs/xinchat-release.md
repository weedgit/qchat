# XinChat release guide

XinChat is a second branded client for the same Qchat/Rchat API. Accounts, enterprises, chats, and media are **shared** with Rchat; only app packaging and UI differ.

| Client | Folder | Production |
|--------|--------|------------|
| Web | `apps/xin-web` | `https://<host>/xin/` |
| Mobile | `apps/xin-mobile` | `com.xinchat.mobile` |
| Desktop | `apps/xin-desktop` | Electron shell → `/xin/` |

Overview and dev shortcuts: [`apps/XINCHAT.md`](../apps/XINCHAT.md).

## Web

```bash
make xin-web                    # dev http://localhost:3001/xin/
./deploy/redeploy.sh --xin-web --skip-env-check
make smoke-xin
```

Download page: `/xin/download` · PWA manifest theme: emerald green (`#059669`).

## Desktop installers

Build:

```bash
cd apps/xin-desktop && npm ci && npm run check
npm run dist:linux              # AppImage (recommended on Linux VPS)
npm run dist:win:docker         # Windows .exe via Docker on Linux
npm run dist:mac                # macOS only — on a Mac
```

Publish to the download page (binaries are **not** in git):

```bash
./scripts/sync-xin-installers.sh
./deploy/redeploy.sh --xin-web --sync-xin-installers --skip-env-check
# or: make publish-xin
```

### Auto-update feed

| Item | URL / path |
|------|------------|
| Feed | `https://<host>/xin-desktop-updates/` |
| Host dir | `/var/www/xin-desktop-updates/` |

```bash
./deploy/setup-xin-release.sh    # once
cd apps/xin-desktop && npm run dist:linux:publish
make sync-xin-desktop-updates DEST=/var/www/xin-desktop-updates
# or: make publish-xin-full
```

Smoke: `bash deploy/smoke-xin-desktop-updates.sh`

### macOS

Cannot cross-build `.dmg` on Linux. On a Mac:

```bash
cd apps/xin-desktop
npm ci && npm run check && npm run dist:mac
```

Copy the `.dmg` into `apps/xin-desktop/dist/`, then `make publish-xin`. For notarization / signing, see `apps/xin-desktop/README.md` and `scripts/afterSign.js`.

## Mobile (EAS)

Separate Expo project and push credentials from Rchat (`com.qchat.mobile`). Use **`npm run eas:*`** scripts (pinned `eas-cli@16.x` — not `npx eas-cli@21`).

```bash
cd apps/xin-mobile
npm run bootstrap
npm run eas:login          # or eas:ci-login with EXPO_TOKEN in .env
npm run eas:onboard        # once — new project, not Rchat
npm run eas:build:preview  # internal APK
```

Headless wait + publish:

```bash
make wait-eas-xin-apk
```

Pull APK manually:

```bash
./scripts/eas-pull-xin-apk.sh preview
make publish-xin
```

Profiles (`eas.json`): `development` (dev client + cleartext), `preview` (QA APK), `production` (stores — no cleartext, no trust plugin).

Local checks: `npm run typecheck` · `npm run check:release`

Rchat EAS mechanics: [`mobile-release.md`](./mobile-release.md).

## Store submit checklist

| Store | Bundle ID |
|-------|-----------|
| Google Play | `com.xinchat.mobile` |
| App Store | `com.xinchat.mobile` |
| Desktop (optional) | `com.xinchat.desktop` |

Before first production build:

- [ ] `npm run eas:onboard` (new Expo project)
- [ ] `npx eas-cli credentials` for Android + iOS
- [ ] `npm run check:release` passes
- [ ] Production URLs in EAS env: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_LIVEKIT_URL`
- [ ] **New** FCM / APNs / Getui apps (do not reuse Rchat IDs)
- [ ] Icons: `make xin-icons` (green **X** assets)
- [ ] Privacy policy + terms URLs for store consoles

Google Play: create app `com.xinchat.mobile` → `npm run eas:build:android` → `npx eas-cli submit --profile production --platform android`. Listing name **XinChat**, screenshots from green UI.

Apple: App Store Connect app with same bundle ID → `npm run eas:build:ios` → submit. Separate APNs key in EAS.

Internal QA before store upload: preview APK on `https://<host>/xin/download`.

## Make targets (repo root)

```bash
make xin-icons              # regenerate XinChat icon assets
make xin-redeploy           # build xin-web + reload nginx
make sync-xin-installers    # dist/APK → xin-web/public/downloads
make publish-xin            # sync installers + redeploy
make publish-xin-linux      # Linux desktop build + publish
make publish-xin-full       # update feed + downloads + redeploy + smoke
make xin-mobile-eas-onboard # EAS init helper
```

## Related

- Nginx / systemd: [`deployment-nginx-systemd.md`](./deployment-nginx-systemd.md)
- Download folder notes: [`apps/xin-web/public/downloads/README.md`](../apps/xin-web/public/downloads/README.md)
