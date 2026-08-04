# XinChat mobile — separate from Rchat on Google Play / App Store

XinChat uses bundle ID **`com.xinchat.mobile`**. You need a **separate Expo project** and **separate push credentials** from Rchat (`com.qchat.mobile`).

## One-time setup

```bash
cd apps/xin-mobile
npm run bootstrap
npm run eas:login
npm run eas:onboard    # new Expo project, not Rchat
```

EAS CLI is pinned in this package (`eas-cli@16.x`). Use `npm run eas:*` scripts.

### Headless (VPS / CI)

```bash
# EXPO_TOKEN in .env — https://expo.dev/settings/access-tokens
npm run eas:ci-login
npm run eas:onboard
npm run eas:build:preview
# from repo root: make wait-eas-xin-apk
```

### Interactive

## Profiles (`eas.json`)

| Profile | Use | Trust self-signed | Cleartext |
|---------|-----|-------------------|-----------|
| `development` | Dev client APK | yes (`XINCHAT_TRUST_CERT=1`) | yes |
| `preview` | Internal QA | yes | no |
| `production` | Store release | **no** | **no** |

## Local checks

```bash
cd apps/xin-mobile
npm run typecheck
npm run check:release
```

## Build

```bash
npm run eas:build:preview      # internal APK
npm run eas:build:android      # Play Store AAB/APK
npm run eas:build:ios          # App Store
```

After a cloud build, pull the APK and publish to `/xin/download`:

```bash
../../scripts/eas-pull-xin-apk.sh preview
../../scripts/publish-xin-release.sh --skip-dist
```

With explicit API host:

```bash
EXPO_PUBLIC_API_URL=https://your-host \
EXPO_PUBLIC_LIVEKIT_URL=wss://your-host:7443 \
npx eas-cli build --profile production --platform android
```

## Submit

```bash
npx eas-cli submit --profile production --platform android
npx eas-cli submit --profile production --platform ios
```

## Push (Getui / FCM / APNs)

Register **XinChat** as a new app in each push provider. Do not reuse Rchat app IDs.

## Icons

Regenerate violet **X** icons after brand changes:

```bash
python3 scripts/generate-xinchat-icons.py
cd apps/xin-desktop && node scripts/build-icon-ico.js
./deploy/redeploy.sh --xin-web --skip-env-check
```

See also: [mobile-release.md](./mobile-release.md) (same EAS mechanics as Rchat).

Store checklist: [xinchat-store-submit.md](./xinchat-store-submit.md).
