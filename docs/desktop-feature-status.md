# Qchat Desktop — Feature Status (one table)

> **Owner:** Kevin — `apps/desktop` only (Electron shell)
> **Sources:** `requirements-en.md` §3 (Windows/macOS)
> **Rule:** each row is **one** development unit (one commit / one branch slug). Web, API, admin, and ops work are **out of scope** for this doc.

### Column legend

| Column | Meaning |
|---|---|
| **ID** | Stable unit id |
| **Req** | `requirements-en.md` section, or `Shell` = desktop shell capability |
| **Unit** | Single feature/function — commit-sized |
| **Notes** | Implementation notes / module |
| **Status** | `Done` / `Partial` / `Todo` / `Deferred` |
| **Slug** | Suggested `feat-kevin-desktop-<slug>` |

---

| ID | Req | Unit | Notes | Status | Slug |
|---|---|---|---|---|---|
| AUTH-01 | §2.1 | Captcha fetch via main-process IPC | session networking | Done | `feat-kevin-desktop-captcha-ipc` |
| AUTH-02 | §2.1 | Send `device_type=desktop` / desktop device name | externalAPI / server view identity | Done | `feat-kevin-desktop-device-identity` |
| AUTH-03 | §2.1 | Remember session via `safeStorage` tokens | secureStorage.ts | Done | `feat-kevin-desktop-safe-storage` |
| AUTH-04 | §2.3 | Idle detection → away status bridge | UserActivityMonitor.ts | Done | `feat-kevin-desktop-idle-status` |
| AUTH-05 | §2.1 | Same-type session kick (`session.revoked`) | session management | Done | `feat-kevin-desktop-session-kick` |
| CALL-01 | §2.4 | Grant mic / camera permission | permissionsManager | Done | `feat-kevin-desktop-media-permission` |
| CALL-02 | §2.4 | Screenshare via `desktopCapturer` | callsWidgetWindow / desktopCapturer | Done | `feat-kevin-desktop-screenshare` |
| CALL-03 | §2.4 | Separate Calls widget window | callsWidgetWindow.ts | Deferred | `feat-kevin-desktop-calls-widget` |
| PLAT-01 | §3 | Windows NSIS installer | electron-builder / nsis | Done | `feat-kevin-desktop-win-nsis` |
| PLAT-02 | §3 | macOS dmg installer | electron-builder / dmg | Done | `feat-kevin-desktop-mac-dmg` |
| PLAT-03 | §3 | Linux AppImage + deb | AppImage / deb | Done | `feat-kevin-desktop-linux-pack` |
| NOTI-01 | Shell | Native OS notification | `src/main/notifications/` | Done | `feat-kevin-desktop-native-notify` |
| NOTI-02 | Shell | Click notification → focus + open chat | navigationManager deep link | Done | `feat-kevin-desktop-notify-deeplink` |
| NOTI-03 | Shell | Dock / taskbar unread badge | badge.ts | Done | `feat-kevin-desktop-unread-badge` |
| NOTI-04 | Shell | Tray icon unread / mention state | tray.ts + AppState | Done | `feat-kevin-desktop-tray-badge` *(tooltip/title + web totals; custom tray images later)* |
| NOTI-05 | Shell | Flash / bounce on mention (Win/mac) | notifications flash/bounce | Done | `feat-kevin-desktop-attention` |
| SHELL-01 | §3 | Electron window loads web client | BrowserWindow / WebContentsView | Done | `feat-kevin-desktop-shell-window` |
| SHELL-02 | Shell | `contextIsolation` + no `nodeIntegration` | security defaults | Done | `feat-kevin-desktop-secure-prefs` |
| SHELL-03 | Shell | Narrow preload bridge `qchatDesktop` | externalAPI preload | Done | `feat-kevin-desktop-preload-bridge` |
| SHELL-04 | Shell | Renderer sandbox enabled | webPreferences.sandbox | Done | `feat-kevin-desktop-renderer-sandbox` |
| SHELL-05 | Shell | Configurable web URL (`--url` / env / `.env`) | servers config | Done | `feat-kevin-desktop-web-url-config` |
| SHELL-06 | Shell | Packaged default production URL | Config / production.json | Done | `feat-kevin-desktop-prod-url` |
| SHELL-07 | Shell | End-user `userData/config.json` URL override | Config | Done | `feat-kevin-desktop-user-config` |
| SHELL-08 | Shell | Start at `/login` | navigation | Done | `feat-kevin-desktop-start-login` |
| SHELL-09 | Shell | Single-instance lock | requestSingleInstanceLock | Done | `feat-kevin-desktop-single-instance` |
| SHELL-10 | Shell | Second instance focuses existing window | app second-instance | Done | `feat-kevin-desktop-focus-existing` |
| SHELL-11 | Shell | External http(s) links → OS browser | shell.openExternal | Done | `feat-kevin-desktop-open-external` |
| SHELL-12 | Shell | Failed web load → error dialog | ErrorView | Done | `feat-kevin-desktop-load-error` |
| SHELL-13 | Shell | Persist window size / position | mainWindow bounds-info | Done | `feat-kevin-desktop-window-state` |
| SHELL-14 | Shell | App icon (window / taskbar) | assets / tray icons | Done | `feat-kevin-desktop-app-icon` |
| SHELL-15 | Shell | Window title locked to product name | mainWindow title | Done | `feat-kevin-desktop-window-title` |
| SHELL-16 | Shell | About dialog | appMenu about | Done | `feat-kevin-desktop-about` |
| SHELL-17 | Shell | Native app menu (Edit / View / Window) | `src/app/menus/` | Done | `feat-kevin-desktop-app-menu` |
| SHELL-18 | Shell | Menu reload / zoom in-out-reset | view.ts zoom | Done | `feat-kevin-desktop-zoom-menu` |
| SHELL-19 | Shell | Spellcheck in composer | spellChecker session | Done | `feat-kevin-desktop-spellcheck` |
| SHELL-20 | Shell | Download → OS save dialog | downloadsManager | Done | `feat-kevin-desktop-download-save` |
| SHELL-21 | Shell | Download completion notification | notifications/Download | Done | `feat-kevin-desktop-download-notify` |
| SHELL-22 | Shell | Right-click context menu | contextMenu.ts | Done | `feat-kevin-desktop-context-menu` |
| SHELL-23 | Shell | System tray icon | tray/tray.ts | Done | `feat-kevin-desktop-system-tray` |
| SHELL-24 | Shell | Minimize / close to tray | minimizeToTray | Done | `feat-kevin-desktop-close-to-tray` |
| SHELL-25 | Shell | Tray menu Show / Quit | menus/tray.ts | Done | `feat-kevin-desktop-tray-menu` |
| SHELL-26 | Shell | Autostart on OS login | AutoLauncher.ts | Done | `feat-kevin-desktop-autostart` |
| SHELL-27 | Shell | Hide on start (start minimized) | AutoLauncher hideOnStart | Done | `feat-kevin-desktop-hide-on-start` |
| SHELL-28 | Shell | Protocol handler `qchat://` | `qchat://` deep links | Done | `feat-kevin-desktop-protocol-qchat` |
| SHELL-29 | Shell | Open conversation from deep link | navigationManager | Done | `feat-kevin-desktop-deeplink-chat` |
| SHELL-30 | Shell | Certificate error trust/deny UI | certificateStore.ts | Done | `feat-kevin-desktop-cert-dialog` |
| SHELL-31 | Shell | Theme sync with OS | themeManager.ts | Done | `feat-kevin-desktop-os-theme` |
| SHELL-32 | Shell | Offline / reconnect banner (shell) | ErrorView / isOnline | Done | `feat-kevin-desktop-offline-banner` |
| SHELL-33 | Shell | Multi-server tabs | tabs / servers | Deferred | `feat-kevin-desktop-multi-server` |
| SHELL-34 | Shell | Pop-out windows | popoutManager.ts | Deferred | `feat-kevin-desktop-popout` |
| SHELL-35 | Shell | GPO / MDM enterprise config | policyConfigLoader | Deferred | `feat-kevin-desktop-gpo` |
| PACK-01 | §3 | electron-builder project config | packaging | Done | `feat-kevin-desktop-builder-config` |
| PACK-02 | Shell | Windows build via Wine Docker on Linux | builder:wine | Done | `feat-kevin-desktop-win-docker` |
| PACK-03 | Shell | Bundle static `apps/web/out` offline | asar extraResources | Deferred | `feat-kevin-desktop-offline-web` |
| PACK-04 | Shell | Windows Authenticode signing | code sign | Done | `feat-kevin-desktop-win-sign` |
| PACK-05 | Shell | macOS Developer ID + notarization | notarize | Done | `feat-kevin-desktop-mac-notarize` |
| PACK-06 | Shell | Auto-update (`electron-updater`) | updateNotifier | Done | `feat-kevin-desktop-auto-update` |
| PACK-07 | Shell | Ship without `--no-sandbox` | production hardening | Done | `feat-kevin-desktop-prod-sandbox` |
| PACK-08 | Shell | Crash / telemetry hooks | diagnostics | Deferred | `feat-kevin-desktop-crash-report` |

---

### Todo backlog (implement one row = one commit)

*(No open desktop units — deferred items only: CALL-03, SHELL-33–35, PACK-03, PACK-08.)*

**In progress:** supply real `CSC_*` / `APPLE_*` credentials when ready to ship signed builds.

> Note: `IMPLEMENTATION_STATUS.md` Phase 6 still says desktop is “scaffolded.” That understates D1–D3 progress on this branch.

---

## 3. Features to implement (desktop-only)

Full list across D0–D5:

1. Electron shell loading the web client  
2. Secure preload bridge (`contextIsolation`, no `nodeIntegration`)  
3. Configurable production/local web URL  
4. Desktop session identity (`device_type=desktop`)  
5. Login / chat / WebSocket inside the window  
6. App icon, window title, About dialog  
7. Window state restore, native menus, shortcuts  
8. Native notifications → focus + open conversation  
9. Download save dialog  
10. Windows / macOS (/ Linux) installers  
11. System tray / minimize to tray  
12. Autostart on login  
13. `qchat://` protocol handler + open conversation from deep link — Done  
14. Secure token storage (`safeStorage`) — Done  
15. Code signing + auto-update  

---

## 4. Phase detail — done / todo / verification

### D0 — Shell bootstrap — Done

| Feature | Status | Verification |
|---|---|---|
| Electron window + load web UI | Done | `cd apps/desktop && npm start` opens a window |
| `contextIsolation`, no Node in renderer, sandbox | Done | Inspect `main.js` → `webPreferences` |
| Narrow `preload` bridge | Done | DevTools console: `window.qchatDesktop` |
| External / off-origin links → OS browser | Done | Click an external link in chat |
| Failed-load error dialog | Done | Set a bad `QCHAT_WEB_URL` and start |

---

### D1 — Dev desktop (URL + session) — Done

| Feature | Status | Verification |
|---|---|---|
| Configurable web URL (`QCHAT_WEB_URL` / `--url` / `.env`) | Done | `QCHAT_WEB_URL=http://HOST npm start` |
| Start at `/login` | Done | First screen is Sign in |
| `device_type=desktop` + desktop `device_name` | Done | Network tab on `/v1/auth/login` payload |
| Captcha via main-process IPC | Done | Captcha code appears (needs current web build or local web) |
| Single-instance lock | Done | Start app twice → second focuses first |
| Login + chat + WebSocket | Done | Sign in, send/receive messages |

**D1 exit criteria:** login, conversation list, and realtime messaging work inside Electron against local or deployed web.

---

### D2 — UX polish — Done

| Feature | Status | Verification |
|---|---|---|
| App icon | Done | Title bar / taskbar / Alt-Tab shows Qchat icon |
| Title locked to **Qchat Desktop** | Done | Title bar text stays `Qchat Desktop` |
| About dialog | Done | **Help → About Qchat Desktop** or `Ctrl+Shift+A` |
| Window size/position restore | Done | Resize → quit → reopen; position restored |
| Native menu (reload / zoom / edit) | Done | Use **View** / **Edit** menus |
| Native notification → focus + open chat | Done | Receive message while unfocused → click notification |
| Download save dialog | Done | Download an attachment → OS Save dialog |
| Spellcheck | Done | Typo underline in composer |
| Dedicated offline banner | Done | Desktop shell shows “No internet connection” / “Reconnecting…” strip; search-field reconnect hint unchanged |


---

### D3 — Packaging — Done (unsigned)

| Feature | Status | Verification |
|---|---|---|
| `electron-builder` config + scripts | Done | `apps/desktop/package.json` → `build` + `dist:*` |
| Linux AppImage / deb | Done | `npm run dist:linux` → artifacts in `apps/desktop/dist/` |
| Windows NSIS | Done (build on Win / wine) | `npm run dist:win` → Setup `.exe` |
| macOS dmg | Done (build on macOS) | `npm run dist:mac` → `.dmg` |
| Production web URL in shipped app | Done | `production.json` + packaged fallback; override via `userData/config.json` |
| Optional offline bundle of `apps/web/out` | Deferred | Still loads remote web; local `out/` bundle later if needed |

**D3 exit criteria:** installable desktop apps that talk to the production API/web (signing deferred to D5).

---

### D4 — Desktop-native integrations — Partial

| Feature | Status | Verification (when done) |
|---|---|---|
| Native notifications + deep-link to conversation | **Done** (in D2) | Same as D2 notification test |
| Dock / taskbar unread badge | **Done** | Mentions show a count; plain unread shows a dot (Win overlay / macOS Dock / Linux badge count) |
| System tray / minimize to tray | **Done** | Close-to-tray; tray menu Show / Quit; tooltip reflects unread |
| Autostart on OS login | **Done** | Preferences / tray menu |
| Hide on start | **Done** | Starts in tray when enabled (`--hidden` / login-item hidden also honored); Show / deep link still opens the window |
| Protocol handler `qchat://` | **Done** | `qchat://conversation/<id>` focuses app and opens chat |
| Secure token storage (`safeStorage`) | **Done** | Tokens encrypted in `userData/secure/` via Electron `safeStorage`; desktop opens `/` when a session exists |

---

### D5 — Signing & release — Done (credentials optional)

| Feature | Status | Verification (when done) |
|---|---|---|
| Windows Authenticode signing | Done | Scaffolded: `CSC_LINK` + `CSC_KEY_PASSWORD` (or `WIN_CSC_*`); sha256 + DigiCert timestamp; unsigned builds still work (`forceCodeSigning: false`) |
| macOS Developer ID + notarization | Done | Scaffolded: hardened runtime + entitlements; `afterSign` notarizes when `APPLE_*` + `CSC_*` set; skipped otherwise |
| Auto-update (`electron-updater`) | Done | Packaged + `updateUrl` / `QCHAT_UPDATE_URL`; Help → Check for Updates; no-op when URL empty or unpackaged |
| Production hardening (no `--no-sandbox` in ship) | Done | `app.enableSandbox()`; packaged ignores `QCHAT_DESKTOP_NO_SANDBOX`; Linux afterPack setuid on `chrome-sandbox`; `--no-sandbox` remains explicit dev/VM only |
| Crash / telemetry hooks (optional) | Deferred | Crash report appears in chosen service |

---

## 5. Session / platform notes (desktop)

| Requirement | Current behavior | Gap |
|---|---|---|
| Phone + computer concurrent | Supported (`phone` vs `desktop` buckets) | OK — both may stay signed in |
| Same-type device kick | New login of that type revokes prior session, pushes `session.revoked`, closes WS | OK |
| Browser vs Electron | Separate `web` and `desktop` — both can stay; second of the same type kicks the first | OK |
| Windows / macOS clients | Installers via electron-builder (D3); signing optional via env (D5 scaffold) | Provide `CSC_*` / `APPLE_*` for distribution |
| Native store apps | Explicitly deferred in security decisions | Out of MVP |

---

## 6. How to run (dev)

```bash
# Attach display if using Cursor/SSH/tty on Linux
cd apps/desktop
source ./attach-display.sh

# Against deployed server
npm run start:server

# Against local web
# terminal A: cd apps/web && npm run dev
npm run start:local
```

### Code map

| Area | Path |
|---|---|
| Electron main | `apps/desktop/main.js` |
| Preload | `apps/desktop/preload.js` |
| URL config | `apps/desktop/config.js`, `production.json` |
| Packager | `apps/desktop/package.json` → `build`, `dist-win.sh` |
| Shell sources | `apps/desktop/src/` |
