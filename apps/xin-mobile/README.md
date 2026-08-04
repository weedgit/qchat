# XinChat mobile (Expo / React Native)

XinChat Android/iOS — same API as Rchat, separate store listing (`com.xinchat.mobile`).

## Dev

```bash
cd apps/xin-mobile
cp .env.example .env   # EXPO_PUBLIC_API_URL, LIVEKIT URL
npm ci
npx expo start
```

Login screen links to Rchat web on the same host (`/login`).

## Release checks

```bash
npm run typecheck
npm run check:release
```

## Quick bootstrap (no Expo login)

```bash
cd apps/xin-mobile
npm run bootstrap    # .env from example + typecheck + check:release
```

## EAS (first time)

```bash
npm run eas:onboard
npx eas-cli credentials --platform android
```

## Preview APK (internal QA)

```bash
npm run eas:build:preview
# or: bash scripts/eas-build-preview.sh
```

After the cloud build finishes:

```bash
../../scripts/eas-pull-xin-apk.sh preview
../../scripts/publish-xin-release.sh --skip-dist
```

APK appears on `https://<host>/xin/download`.

## Production (stores)

```bash
npm run eas:build:android
npm run eas:build:ios
npx eas-cli submit --profile production --platform android
```

See [docs/xinchat-mobile-release.md](../docs/xinchat-mobile-release.md) and [docs/xinchat-store-submit.md](../docs/xinchat-store-submit.md).

## Branding

- Violet theme: `src/theme.ts`
- App name: `src/lib/brand.ts`
- Storage keys: `xinchat.*` (separate from Rchat if both apps installed)
