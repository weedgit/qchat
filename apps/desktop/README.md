# Qchat Desktop (Electron)

Thin shell around the web client (Mattermost-inspired **main / preload / shared**
layout under `src/`). See `docs/architecture.md`. **D3** adds installable packages
via `electron-builder`.

## Layout

```text
src/main/       Electron main process
src/preload/    contextBridge → window.qchatDesktop
src/shared/     IPC channel names + constants
assets/         icons
production.json shipped web URL default
```

## Prerequisites

- API running from `services/api`
- Node.js 22 or newer
- npm dependencies installed in `apps/web` and `apps/desktop`

## Linux development (including CachyOS/Arch)

Keep the API running in one terminal:

```bash
cd services/api
go run ./cmd/api
```

Run desktop development in another:

```bash
cd apps/desktop
npm install
npm run dev
```

`npm run dev` starts `apps/web` when port 3000 is not already serving, waits
for it, and opens Electron with DevTools.

On CachyOS/Arch, install missing desktop libraries with:

```bash
sudo pacman -S --needed gtk3 nss alsa-lib libxss
```

If the Chromium sandbox is unavailable in a development VM:

```bash
npm run dev:no-sandbox
```

Do not use the no-sandbox command for packaged or production use.

### Voice / video calls (LiveKit)

Calls need LiveKit on port **7880** reachable from the desktop shell. Typical
local setup:

```bash
# from qchat/
./deploy/render-media-config.sh
set -a && source deploy/generated/media.env && set +a
docker compose up -d livekit coturn
```

`apps/web/.env.local` should set `NEXT_PUBLIC_LIVEKIT_URL=ws://<LAN-IP>:7880`
(not Cursor-only localhost). Prefer loading the web UI on the same LAN host:

```bash
npm run start:lan    # picks a reachable RFC1918 IP (skips VPN/docker); falls back to localhost
# force a host if needed:
QCHAT_LAN_IP=192.168.1.124 npm run start:lan
# or keep localhost (Electron also disables Chromium local-network blocks):
npm run start:local
```

If you still see “Couldn’t reach LiveKit signaling”, confirm `curl http://<LAN-IP>:7880`
returns OK and restart Electron so Chromium flags apply.

### Voice / video calls (LiveKit)

Calls need LiveKit on port **7880** reachable from the desktop shell. Typical
local setup:

```bash
# from qchat/
./deploy/render-media-config.sh
set -a && source deploy/generated/media.env && set +a
docker compose up -d livekit coturn
```

`apps/web/.env.local` should set `NEXT_PUBLIC_LIVEKIT_URL=ws://<LAN-IP>:7880`
(not Cursor-only localhost). Prefer loading the web UI on the same LAN host:

```bash
npm run start:lan    # http://<detected-LAN-IP>:3000
# or keep localhost (Electron also disables Chromium local-network blocks):
npm run start:local
```

If you still see “Couldn’t reach LiveKit signaling”, confirm `curl http://<LAN-IP>:7880`
returns OK and restart Electron so Chromium flags apply.

### Missing X server or `$DISPLAY`

Run Electron from a terminal opened in the graphical desktop session. For a
local terminal that cannot see the session, try:

```bash
source ./attach-display.sh
npm run dev
```

For a headless smoke test, install `xvfb` and run:

```bash
npm run start:headless
```

## Windows 11 development

1. Install Git, Node.js 22 LTS, Go, and Docker Desktop.
2. Clone Qchat and start its infrastructure and API.
3. In PowerShell:

```powershell
cd qchat\apps\desktop
npm install
npm run dev
```

The launcher uses `npm.cmd` automatically on Windows, so Git Bash or WSL is
not required for the desktop process.

## Other run modes

```bash
npm start                 # desktop only; defaults to localhost when unpackaged
npm run dev:desktop       # desktop + DevTools; web must already be running
npm run start:server      # connect to the deployed Qchat server
npm start -- --url=http://10.80.45.152
```

Config precedence:

1. `--url` CLI
2. `QCHAT_WEB_URL` environment variable
3. `.env` in `apps/desktop`
4. `userData/config.json` in packaged apps
5. `production.json` in packaged apps
6. localhost in development or the production fallback when packaged

## Packaging

Artifacts are written to `apps/desktop/dist/`. Packaged apps load
`production.json` (`https://135.181.224.36`). The shell trusts that host’s
TLS certificate when it is self-signed (nginx IP cert), so the installer does
not fail with `ERR_CERT_AUTHORITY_INVALID`.

```bash
npm run pack          # unpacked app for a fast smoke test
npm run dist:linux    # AppImage + deb; build on Linux
npm run dist:win      # NSIS .exe; build on Windows (recommended)
npm run dist:mac      # dmg; build on macOS
npm run dist          # current platform defaults
```

Windows installers can be cross-built on Linux only with Wine configured.
Building `dist:win` on Windows 11 is the supported development workflow.
Signing and auto-update are not configured yet.

After changing `production.json` or main-process security, rebuild the
installer (`npm run dist:win`) and reinstall — an old Setup.exe still embeds
the previous defaults.

## Desktop behavior

- `contextIsolation`, renderer sandbox, and no renderer Node integration
- Remember me: tokens via Electron `safeStorage` (`userData/secure/`); app opens `/` when a session exists; logout clears the vault
- Origin-scoped permissions and external navigation checks
- Certificate errors: trust / deny dialog (persisted); configured web host stays auto-trusted
- Right-click: cut/copy/paste, links, images, spellcheck (gated so web chat menus still work)
- Theme: shell chrome follows Display → Theme (system / light / dark) via `nativeTheme`
- Offline / reconnect banner in the desktop shell (OS offline + WS reconnect)
- Native notifications that focus the target conversation
- Mentions flash the taskbar (Win/Linux) or bounce the Dock (macOS) when unfocused
- Idle (5 min / lock / sleep) auto-sets status to away; resumes to online (won’t override DND)
- Dock / taskbar unread badge (mentions count or unread dot) via `setUnreadStatus`
- Tray tooltip reflects unread / mention totals
- Deep links: `qchat://conversation/<id>` (also `chat` / `c` / `open?conversation=`) focuses the window and opens that chat
- Hide on start: optional tray-only launch (File / tray menu); also `--hidden`
- Screen share in calls: `getDisplayMedia` via `desktopCapturer` / OS picker (LiveKit)
- Native download save dialog; completion notification opens the file in the folder
- Single-instance window behavior and persisted window bounds
- `window.qchatDesktop` preload bridge for the web client
