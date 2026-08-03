# Qchat mobile (Expo / React Native)

Android-first client that talks to the same Qchat API as web.
Source and Metro run on **Linux**; the emulator can live on the **Windows host**.

## Setup

```bash
cd apps/mobile
cp .env.example .env
npm install
npx expo start
```

## Windows 11 host emulator + Linux source (your setup)

Linux VM: `192.168.91.136` · Windows host (VMware gateway): `192.168.91.2`

Metro/API stay on Linux. The emulator only displays the app.

### 1. Linux — install `adb`

```bash
sudo pacman -S android-tools
```

### 2. Windows — start emulator + expose adb server

In **PowerShell (Admin)** on Windows, with the emulator already running:

```powershell
adb kill-server
# Listen on all interfaces so the Linux VM can reach this adb server
adb -a -P 5037 nodaemon server
```

Allow inbound **TCP 5037** in Windows Firewall for the VMware network.

Keep that window open. In another Windows shell: `adb devices` should list `emulator-5554`.

Install **Expo Go** in the emulator (Play Store or APK).

### 3. Linux — attach to Windows adb + reverse ports

```bash
cd apps/mobile
chmod +x scripts/connect-windows-emulator.sh
./scripts/connect-windows-emulator.sh
```

This talks to `adb` on `192.168.91.2:5037` and runs:

- `adb reverse tcp:8081 tcp:8081` (Metro)
- `adb reverse tcp:8080 tcp:8080` (API)

### 4. Linux — run the app source

```bash
# API via reverse tunnel (emulator sees 127.0.0.1)
EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 npx expo start
```

In Expo Go on the emulator: **Enter URL** → `exp://127.0.0.1:8081`

Or, if `adb devices` shows the emulator from Linux:

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 npx expo start --android
```

You do **not** need a full Android SDK on Linux for Expo Go. You only need `adb` (+ the reverse tunnels).

## Custom dev client (HTTPS + self-signed TLS)

Expo Go cannot trust the deploy host’s self-signed cert (`deploy/certs/qchat.crt`).
Use a development build that embeds that cert via Android `network_security_config`.

1. Copy the **public** cert from the server (not the private key):

```bash
# from the deploy host, or scrape the live cert:
# scp root@135.181.224.36:/root/qchat/deploy/certs/qchat.crt apps/mobile/certs/qchat.crt
```

Ensure `apps/mobile/certs/qchat.crt` exists (PEM).

2. Set `.env`:

```
EXPO_PUBLIC_API_URL=https://135.181.224.36
EXPO_PUBLIC_LIVEKIT_URL=wss://135.181.224.36:7443
```

Voice/video calls use LiveKit + WebRTC native modules. After installing or changing those plugins, rebuild the native app (`npx expo run:android` / `run:ios`) — Metro reload alone is not enough.

3. Build and install the Android dev client (needs Android SDK / Studio):

```bash
cd apps/mobile
npm install
npx expo run:android
```

4. Later sessions — Metro only (app already installed):

```bash
npx expo start --dev-client
# press a, or open the Qchat app on the emulator
```

If the server rotates TLS (`./deploy/generate-tls.sh`), refresh `certs/qchat.crt` and rebuild.

**iOS note:** ATS exceptions do not accept invalid certs. Install the cert in Settings → General → About → Certificate Trust Settings, or use a real CA / tunnel.

## Auth device

Login/register send `device_type: "phone"` (browser uses `web`, Electron uses `desktop`). At most one session per type.

## Tabs (随行聊-inspired)

- **消息** — conversation list + unread
- **通讯录** — friends / requests / open DM
- **我的** — profile + logout

## Release / EAS

Store and internal APK builds use EAS profiles. See **[docs/mobile-release.md](../../docs/mobile-release.md)** for profile matrix, credentials (never commit secrets), CI, and `npm run check:release`.

```bash
cd apps/mobile
npm run check:release
npm run eas:build:preview   # requires eas-cli login + project
```

Remote push (China mainland) uses **个推 Getui** CID via `src/lib/remotePush.ts` → `POST /v1/push/register` (`platform: getui`). OEM channels are configured in the Getui console. Expo Push is a fallback when the native module is absent. See **[docs/push.md](../../docs/push.md)**.
