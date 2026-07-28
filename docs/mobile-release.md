# Mobile release (EAS)

Qchat mobile ships via **Expo Application Services (EAS)**. Server deploy under `deploy/` does **not** package Android/iOS binaries.

## Profiles (`apps/mobile/eas.json`)

| Profile | Purpose | Trust self-signed cert | Cleartext | Dev client |
|---------|---------|------------------------|-----------|------------|
| `development` | Local/dev APK + Metro | yes | yes | yes |
| `preview` | Internal APK for QA | yes (optional) | no | no |
| `production` | Store / public release | **no** | **no** | **no** |

Production builds expect a real CA certificate on the API host (or a CDN/front door). Do not embed `certs/qchat.crt` in store builds.

## One-time setup

```bash
cd apps/mobile
cp .env.example .env
# Set production URLs when building preview/production:
# EXPO_PUBLIC_API_URL=https://chat.example.com
# EXPO_PUBLIC_LIVEKIT_URL=wss://chat.example.com:7443

npm install
npx eas-cli login
npx eas-cli init   # creates Expo project; set EAS_PROJECT_ID in env or app.config.js
```

Signing credentials stay in EAS (or your CI secrets). **Never commit** keystores, `.p8`/`.p12`, `credentials.json`, `google-services.json`, or `EXPO_TOKEN`.

```bash
npx eas-cli credentials   # configure Android keystore / Apple distribution
```

## Local checks (no cloud secrets required)

```bash
cd apps/mobile
npm run typecheck
npm run check:release
```

`check:release` asserts production gating (no cleartext, no trust plugin, no dev-client).

## Build

Uses `npx eas-cli` (no permanent `eas-cli` dependency required):

```bash
# Internal QA APK
npm run eas:build:preview

# Store candidates
npm run eas:build:android
npm run eas:build:ios

# Or all platforms for production
npx eas-cli build --profile production --platform all
```

Pass public env at build time if not stored in EAS secrets:

```bash
EXPO_PUBLIC_API_URL=https://chat.example.com \
EXPO_PUBLIC_LIVEKIT_URL=wss://chat.example.com:7443 \
npx eas-cli build --profile production --platform android
```

## Submit (after a production build)

```bash
npx eas-cli submit --profile production --platform android
npx eas-cli submit --profile production --platform ios
```

## CI

Example workflow: [`docs/ci/mobile.workflow.example.yml`](ci/mobile.workflow.example.yml).

Copy it to `.github/workflows/mobile.yml` with a token that has the `workflow` scope
(OAuth apps without that scope cannot push workflow files). It runs `typecheck` +
`check:release` on mobile changes. Optional `workflow_dispatch` can trigger an EAS
build when repository secret `EXPO_TOKEN` is set.

## Prebuild notes

- Managed workflow: prefer `eas build` (cloud) over committing `android/` / `ios/`.
- If you run `npx expo prebuild` locally, keep generated trees gitignored.
- After changing native plugins (LiveKit, WebRTC, cert trust), rebuild the native binary — Metro reload is not enough.
- Remote push (FCM/APNs) is still deferred (`src/lib/notifyPort.ts`); store builds can ship without it.

## Related

- Dev emulator / self-signed TLS: `apps/mobile/README.md`
- API / nginx / media: `deploy/`
