# Qchat Desktop (Electron)

Thin shell around the web client (Mattermost-inspired pattern). **D1** loads a
configurable web origin and reports desktop session identity to the API.

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

Electron is a GUI app. If you see:

```text
Missing X server or $DISPLAY
The platform failed to initialize.  Exiting.
```

you are in a text/SSH session without a display. Use a **GUI terminal** on the
Ubuntu desktop (not SSH/tty), or:

```bash
# helpful preflight (exits with instructions if no display)
npm run start:check

# optional: headless smoke only (no visible window)
sudo apt-get install -y xvfb
xvfb-run -a QCHAT_WEB_URL=http://135.181.224.36 npm start
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

## D1 checklist

- [ ] Window opens against local or server web UI
- [ ] Login / chat / WebSocket work inside the window
- [ ] Bad `QCHAT_WEB_URL` shows an error dialog
- [ ] Second launch focuses the existing window
