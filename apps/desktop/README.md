# Qchat Desktop (Electron)

Thin shell around the web client (Mattermost-inspired pattern).

```bash
npm install
# ensure web is running on :3000 and API on :8080
npm start
```

### Linux sandbox note

On some Linux setups (AppArmor, VMs), Electron's setuid `chrome-sandbox` fails even after:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`npm start` disables the Chromium sandbox for local dev (`--no-sandbox`). Use `npm run start:sandbox` only if setuid sandbox works on your machine.

Security: contextIsolation, no nodeIntegration, narrow preload API, external links open in OS browser.
