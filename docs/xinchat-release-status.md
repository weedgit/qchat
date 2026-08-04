# XinChat release status

Last verified on VPS `135.181.224.36`.

## Shipped

| Component | URL / ID | Notes |
|-----------|----------|--------|
| Web | `https://135.181.224.36/xin/` | Violet UI, separate `xinchat.*` storage |
| Download page | `/xin/download` | Linux AppImage + Windows `.exe` |
| Desktop auto-update | `/xin-desktop-updates/` | `latest.yml` + `latest-linux.yml` |
| API | shared `/v1/` | Same backend as Rchat |
| Cross-links | login + settings | Rchat ↔ XinChat on same host |

## Smoke

```bash
make smoke-xin
bash deploy/smoke-xin-desktop-updates.sh
```

## Desktop builds (this repo)

| Platform | Command | Artifact |
|----------|---------|----------|
| Linux | `make xin-desktop-dist-linux` | `xinchat-desktop-*-x86_64.AppImage` |
| Windows (Linux host) | `make xin-desktop-dist-win-docker` | `xinchat-desktop-Setup-*.exe` |
| macOS | on Mac: `npm run dist:mac` | see [xinchat-macos-release.md](./xinchat-macos-release.md) |

Publish everything:

```bash
make publish-xin-full
```

## Mobile (pending Expo account)

Headless VPS / CI (no browser login):

```bash
# 1. Create token at https://expo.dev/settings/access-tokens
# 2. Add to apps/xin-mobile/.env: EXPO_TOKEN=...
cd apps/xin-mobile
npm run eas:ci-login
npm run eas:onboard              # once, sets EAS_PROJECT_ID
npm run eas:build:preview
```

Wait and auto-publish when build finishes:

```bash
make wait-eas-xin-apk            # polls EAS → pull APK → publish-xin
```

Interactive login:

```bash
npm run eas:login
npm run eas:onboard
make xin-mobile-eas-preview
../../scripts/eas-pull-xin-apk.sh preview
make publish-xin
```

EAS CLI pinned at `eas-cli@16.x` — use `npm run eas:*`, not `npx eas-cli@21`.

## Store listings

Checklist: [xinchat-store-submit.md](./xinchat-store-submit.md)

## Related docs

- [apps/XINCHAT.md](../apps/XINCHAT.md)
- [xinchat-mobile-release.md](./xinchat-mobile-release.md)
- [xinchat-desktop-release.md](./xinchat-desktop-release.md)
