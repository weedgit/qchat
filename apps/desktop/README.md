# Qchat Desktop (Electron)

Cross-platform Electron shell around the Qchat web client. The process layout
mirrors Mattermost Desktop's separation of lifecycle, windows, permissions,
IPC, and a narrow context-bridge preload.

## Structure

```text
src/
  main/
    index.js          Electron lifecycle
    window.js         BrowserWindow and navigation policy
    session.js        permissions and downloads
    ipc.js            native notifications and web IPC
    menu.js           application menu and About dialog
    config.js         development/production web URL
  preload/
    index.js          window.qchatDesktop bridge
scripts/
  dev.js              cross-platform web + desktop launcher
  launch.js           desktop-only launcher
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

Artifacts are written to `apps/desktop/dist/`.

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

## Desktop behavior

- `contextIsolation`, renderer sandbox, and no renderer Node integration
- Origin-scoped permissions and external navigation checks
- Native notifications that focus the target conversation
- Native download save dialog
- Single-instance window behavior and persisted window bounds
- `window.qchatDesktop` preload bridge for the web client
