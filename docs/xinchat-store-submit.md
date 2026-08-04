# XinChat store submit checklist

Separate listings from Rchat. Same backend and accounts; different bundle IDs and branding.

| Store | Bundle ID | Folder |
|-------|-----------|--------|
| Google Play | `com.xinchat.mobile` | `apps/xin-mobile` |
| App Store | `com.xinchat.mobile` | `apps/xin-mobile` |
| Desktop (optional) | `com.xinchat.desktop` | `apps/xin-desktop` |

## Before first production build

- [ ] `cd apps/xin-mobile && npm run eas:onboard` (new Expo project, not Rchat)
- [ ] `npx eas-cli credentials` for Android + iOS (`com.xinchat.mobile`)
- [ ] `npm run check:release` passes (no cleartext / trust plugin in production)
- [ ] Set production URLs in EAS secrets or build env:
  - `EXPO_PUBLIC_API_URL=https://your-host`
  - `EXPO_PUBLIC_LIVEKIT_URL=wss://your-host:7443`
- [ ] Register **new** push apps (FCM / APNs / Getui) — do not reuse Rchat IDs
- [ ] Violet **X** icons: `make xin-icons`
- [ ] Privacy policy + terms URLs (store consoles require them)

## Google Play

1. Create app in Play Console with package `com.xinchat.mobile`.
2. Build: `cd apps/xin-mobile && npm run eas:build:android`
3. Download or submit:
   ```bash
   npx eas-cli submit --profile production --platform android
   ```
4. Store listing:
   - App name: **XinChat** (not Rchat)
   - Short description: enterprise messaging (your wording)
   - Screenshots from XinChat UI (violet theme)
   - Feature graphic: violet brand, not Rchat blue
5. Content rating questionnaire (same product category as Rchat).
6. Data safety form — mirror Rchat if same API/data handling.

Internal testing track:

```bash
npm run eas:build:preview
../../scripts/eas-pull-xin-apk.sh preview
make publish-xin
```

APK on `https://<host>/xin/download` for QA before Play upload.

## Apple App Store

1. Create app in App Store Connect with bundle ID `com.xinchat.mobile`.
2. Build: `npm run eas:build:ios`
3. Submit: `npx eas-cli submit --profile production --platform ios`
4. App Review notes: same enterprise backend as companion app Rchat; explain if needed.
5. Push: separate APNs key/certificate in EAS for XinChat.

## Desktop (outside stores)

Optional Microsoft Store / Mac not configured in repo. Distribute via:

- `https://<host>/xin/download`
- Auto-update: `https://<host>/xin-desktop-updates/`

```bash
make publish-xin-linux
```

## Web (no store)

XinChat web is static at `/xin/` — deploy with:

```bash
./deploy/redeploy.sh --xin-web --skip-env-check
```

Smoke: `bash deploy/smoke-xin.sh`

## Post-launch

- [ ] Monitor crash/analytics per app (separate Firebase projects if used)
- [ ] Version bumps: `app.config.js` `version` / `versionCode` / `buildNumber` or EAS remote versions
- [ ] Keep Rchat and XinChat release notes distinct in store consoles

See also: [xinchat-mobile-release.md](./xinchat-mobile-release.md), [xinchat-desktop-release.md](./xinchat-desktop-release.md), [apps/XINCHAT.md](../apps/XINCHAT.md).
