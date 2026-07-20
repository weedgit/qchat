# Qchat Desktop (Electron)

Thin shell around the web client (Mattermost-inspired pattern). **D2** adds
native desktop polish on top of the D1 shell.

## Prerequisites

1. API running (`services/api`)
2. Web UI reachable — local `apps/web` on `:3000`, or a deployed nginx host

## Setup

```bash
cd apps/desktop
cp .env.example .env   # optional
npm install
```

## Run

```bash
# Local Next.js (default QCHAT_WEB_URL / .env / localhost:3000)
npm start

# Explicit local + DevTools
npm run start:local
npm run start:dev

# Deployed server
QCHAT_WEB_URL=http://135.181.224.36 npm start

# CLI flag (works with npm start --)
npm start -- --url=http://10.80.45.152
```

Config precedence: `--url` → `QCHAT_WEB_URL` env → `.env` → `http://localhost:3000`.

### Missing X server / `$DISPLAY`

If you run from **Cursor's terminal**, **SSH**, or a **text console (tty)**, `$DISPLAY`
is often unset even when Ubuntu desktop is running on the same machine.

```bash
# attach to the logged-in GNOME session, then start
source ./attach-display.sh
npm start

# or in one line
source ./attach-display.sh && QCHAT_WEB_URL=http://135.181.224.36 npm start
```

Best option: open **Terminal from the Ubuntu desktop GUI** and run `npm start` there.

Headless smoke (no visible window):

```bash
sudo apt-get install -y xvfb
npm run start:headless
```

### Linux sandbox note

On some Linux setups (AppArmor, VMs), Electron's setuid `chrome-sandbox` fails even after:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`npm start` disables the Chromium sandbox for local dev (`--no-sandbox`). Use `npm run start:sandbox` only if setuid sandbox works on your machine.

## Session policy

Login from this shell sends:

- `device_type`: `desktop`
- `device_name`: `Qchat Desktop (<platform>)`

Browser login uses `device_name: web`. Both share the desktop session bucket
(new desktop login revokes the previous desktop session; phone stays).

## Security

- `contextIsolation`, no `nodeIntegration`, renderer `sandbox`
- Narrow preload bridge: `window.qchatDesktop`
- External / off-origin navigations open in the OS browser
- Single-instance lock; failed loads show an error dialog

## D2 features

- App icon in window / taskbar (`assets/icon.png`)
- Window title locked to **Qchat Desktop**
- Menu bar always visible: **Help → About Qchat Desktop** (or `Ctrl+Shift+A`)
- Restores window size/position between launches
- Native app menu with reload / zoom / edit shortcuts
- Native desktop notifications focus the app and open the target conversation
- Downloaded files use the OS save dialog
- Single-instance behavior focuses the existing window

### Where to find About / icon / title

| Item | Where |
|---|---|
| **Title** | Top of the window: `Qchat Desktop` |
| **Icon** | Window title bar / taskbar / Alt-Tab (Linux may need a restart of the session to refresh) |
| **About** | Menu bar → **Help** → **About Qchat Desktop**, or press `Ctrl+Shift+A` |
