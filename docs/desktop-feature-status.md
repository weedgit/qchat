# Qchat Desktop — Feature Status & Verification

> Owner track: **Desktop (Electron)**  
> Branch (at write time): `feat-kevin-desktop-UX-polish`  
> Pattern: Mattermost-style thin Electron shell wrapping the web client (`apps/desktop`)  
> Related docs: `requirements-en.md`, `implementation-plan.md`, `IMPLEMENTATION_STATUS.md`, `qchat-security-decisions.md`

---

## 1. Client backend requirements (context only)

These items are mostly **admin/API** (not desktop-owned). Desktop only must satisfy **cross-platform login** inside the Electron shell.

| # | Backend requirement | Status (from docs/code) | Desktop impact |
|---|---|---|---|
| 1 | Whitelist / assisted registration | Partial (admin assist exists; allowlist UI thin) | None |
| 2 | Account suspension / ban | Done | Desktop login blocked when banned |
| 3 | Chat history access (enterprise) | Done (reason + audit) | None |
| 4 | Account management / password reset | Done; **password retrieve must never exist** | None |
| 5 | Cross-platform login | Web done; desktop shell works | **Desktop ownership** |
| 6 | Privacy / security (firewall, etc.) | Ops (`HARDENING.md`) | Package securely in D5 |
| 7 | Hierarchical admin (terminal / sub-accounts) | Mostly done (platform / enterprise roles) | None |
| 8 | Registration IP + geo | Done | None |

### Suggested extra backend features (beyond the foundation)

- MFA for administrators
- Invite code rotation / usage limits
- Remote session / device kill from admin
- Retention policies / legal hold
- Malware scan on uploads
- Rate limits + abuse detection
- Audit log export
- Push / message-delivery analytics

---

## 2. Desktop roadmap overview

| Phase | Focus | Status |
|---|---|---|
| **D0** | Shell bootstrap | **Done** |
| **D1** | Dev desktop (URL + session identity) | **Done** |
| **D2** | UX polish | **Done** |
| **D3** | Packaging (installers) | **Done** (unsigned; signing is D5) |
| **D4** | Native integrations (tray, autostart, …) | **Partial** |
| **D5** | Signing & release | **Todo** |

**In progress:** next concrete work is **D4** tray / autostart / protocol (or **D5** signing).

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
13. Optional `qchat://` protocol handler  
14. Optional secure token storage (`safeStorage`)  
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
| Dedicated offline banner | Partial | WS reconnects in `useChat`; no Electron-specific offline banner yet |


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
| System tray / minimize to tray | Todo | Close-to-tray; tray menu Show / Quit |
| Autostart on OS login | Todo | Reboot → app starts |
| Protocol handler `qchat://` | Todo | `qchat://…` opens app / conversation |
| Secure token storage (`safeStorage`) | Todo | Tokens not stored as plain web localStorage |

---

### D5 — Signing & release — Todo

| Feature | Status | Verification (when done) |
|---|---|---|
| Windows Authenticode signing | Todo | No SmartScreen “unknown publisher” (or reduced) |
| macOS Developer ID + notarization | Todo | Gatekeeper accepts the app |
| Auto-update (`electron-updater`) | Todo | New build prompts update |
| Production hardening (no `--no-sandbox` in ship) | Todo | Release start path without dev sandbox bypass |
| Crash / telemetry hooks (optional) | Todo | Crash report appears in chosen service |

---

## 5. Session / platform notes (desktop)

| Requirement | Current behavior | Gap |
|---|---|---|
| Phone + computer concurrent | Supported (`phone` vs `desktop` buckets) | OK |
| Same-type device kick | New desktop login revokes prior desktop session | OK |
| Browser vs Electron | Both use `device_type=desktop` (names differ) | Browser login and Electron login kick each other |
| Windows / macOS clients | Installers via electron-builder (D3); unsigned | **D5** signing for distribution |
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

### Package (D3)

```bash
cd apps/desktop
npm run pack          # unpacked dir under dist/
npm run dist:linux    # AppImage + deb
npm run dist:win      # NSIS (Windows host / wine)
npm run dist:mac      # dmg (macOS host)
```

---

## 7. Suggested next steps (desktop owner)

1. **D4** — tray + autostart (high user-visible value)  
2. Decide with product: should browser + Electron share one desktop session slot?  
3. **D5** — signing + auto-update before wide distribution  
4. Optional: offline bundle of `apps/web/out` inside the installer  
5. Update `IMPLEMENTATION_STATUS.md` Phase 6 to reflect D1–D3 done  

---

## 8. Code map

| Area | Path |
|---|---|
| Electron main | `apps/desktop/main.js` |
| Preload bridge | `apps/desktop/preload.js` |
| URL config | `apps/desktop/config.js` |
| Shipped production URL | `apps/desktop/production.json` |
| electron-builder | `apps/desktop/package.json` → `build` |
| Icons | `apps/desktop/assets/` |
| Device identity (web) | `apps/web/src/lib/device.ts` |
| Desktop bootstrap (web) | `apps/web/src/components/DesktopBootstrap.tsx` |
| Login device + captcha | `apps/web/src/app/login/page.tsx` |
| Notify / open conversation | `apps/web/src/lib/useChat.ts` |
