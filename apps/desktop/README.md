# Qchat Desktop (Electron)

Thin shell around the web client (Mattermost-inspired pattern). **D3** adds
installable packages via `electron-builder`.

## Prerequisites

1. API running (`services/api`)
2. Web UI reachable — local `apps/web` on `:3000`, or a deployed nginx host

## Setup

```bash
cd apps/desktop
cp .env.example .env   # optional (dev override)
npm install
```

## Run (dev)

```bash
# Uses .env / production.json / localhost:3000
npm start

# Explicit local + DevTools
npm run start:local
npm run start:dev

# Deployed server
npm run start:server
# or:
QCHAT_WEB_URL=http://135.181.224.36 npm start

# CLI flag
npm start -- --url=http://10.80.45.152
```

Config precedence:

1. `--url` CLI  
2. `QCHAT_WEB_URL` env  
3. `userData/config.json` (end-user override after install)  
4. `.env` (dev)  
5. `production.json` (shipped default → `http://135.181.224.36`)  
6. Fallback: localhost in unpackaged; production host when packaged  

### Missing X server / `$DISPLAY`

If you run from **Cursor's terminal**, **SSH**, or a **text console (tty)**, `$DISPLAY`
is often unset even when Ubuntu desktop is running on the same machine.

```bash
source ./attach-display.sh
npm start

# or
source ./attach-display.sh && npm run start:server
```

Best option: open **Terminal from the Ubuntu desktop GUI** and run `npm start` there.

Headless smoke (no visible window):

```bash
sudo apt-get install -y xvfb
npm run start:headless
```

### Linux sandbox note

On some Linux setups (AppArmor, VMs), Electron's setuid `chrome-sandbox` fails.
`npm start` disables the Chromium sandbox for local dev (`--no-sandbox`).
Use `npm run start:sandbox` only if setuid sandbox works. Packaged builds do
**not** use `run.sh` / `--no-sandbox` (D5 will harden further).

## Packaging (D3)

Installers land in `apps/desktop/dist/`. Packaged apps load the web URL from
`production.json` (override with env or `~/…/Qchat Desktop/config.json`).

```bash
cd apps/desktop
npm install

# Unpacked app dir (fast smoke on current OS)
npm run pack

# Full installers for this OS / requested targets
npm run dist:linux    # AppImage + deb
npm run dist:win      # NSIS .exe (needs Windows host or wine)
npm run dist:mac      # .dmg (needs macOS)
npm run dist          # defaults for current platform
```

Change the shipped production host by editing `production.json` before building:

```json
{ "webUrl": "http://135.181.224.36" }
```

End users can override without rebuilding — put this in the app userData folder as
`config.json`:

```json
{ "webUrl": "http://your-server" }
```

Signing and auto-update are **D5** (not configured yet).

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
| **Icon** | Window title bar / taskbar / Alt-Tab |
| **About** | Menu bar → **Help** → **About Qchat Desktop**, or `Ctrl+Shift+A` |
