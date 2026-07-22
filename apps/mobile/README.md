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

## Auth device

Login/register send `device_type: "phone"` (web uses `desktop`).

## Tabs (随行聊-inspired)

- **消息** — conversation list + unread
- **通讯录** — friends / requests / open DM
- **我的** — profile + logout

## Next (same branch)

Media upload, FCM push register + server sender, LiveKit 1:1 calls.
