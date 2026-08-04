# XinChat mobile (Expo / React Native)

XinChat Android/iOS — same API and accounts as Rchat, separate store listing (`com.xinchat.mobile`). Emerald green UI; storage keys `xinchat.*`.

## Dev

```bash
cd apps/xin-mobile
cp .env.example .env
npm ci
npx expo start
```

Login screen links to Rchat on the same host (`/login`).

## Checks

```bash
npm run bootstrap       # .env + typecheck + check:release
npm run typecheck
npm run check:release
```

## Release & stores

Full guide: [`docs/xinchat-release.md`](../../docs/xinchat-release.md)

```bash
npm run eas:onboard
npm run eas:build:preview
../../scripts/eas-pull-xin-apk.sh preview
make publish-xin
```

Use `npm run eas:*` scripts (pinned `eas-cli@16.x`).
