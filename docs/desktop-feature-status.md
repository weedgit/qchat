# Qchat Desktop — Feature Status (one table)

> **Owner:** Kevin — `apps/desktop` only (Mattermost Desktop–style Electron shell)  
> **Sources:** `requirements-en.md` §3 (Windows/macOS), Mattermost Desktop (`mattermost/mattermost-desktop`)  
> **Rule:** each row is **one** development unit (one commit / one branch slug). Web, API, admin, and ops work are **out of scope** for this doc.

### Column legend

| Column | Meaning |
|---|---|
| **ID** | Stable unit id |
| **Req** | `requirements-en.md` section, or `MM` = Mattermost Desktop shell capability |
| **Unit** | Single feature/function — commit-sized |
| **MM Desktop** | Mattermost Desktop concept / module to mirror |
| **Status** | `Done` / `Partial` / `Todo` / `Deferred` |
| **Slug** | Suggested `feat-kevin-desktop-<slug>` |

---

| ID | Req | Unit | MM Desktop | Status | Slug |
|---|---|---|---|---|---|
| AUTH-01 | §2.1 | Captcha fetch via main-process IPC | session networking | Done | `feat-kevin-desktop-captcha-ipc` |
| AUTH-02 | §2.1 | Send `device_type=desktop` / desktop device name | externalAPI / server view identity | Done | `feat-kevin-desktop-device-identity` |
| AUTH-03 | §2.1 | Remember session via `safeStorage` tokens | secureStorage.ts | Todo | `feat-kevin-desktop-safe-storage` |
| AUTH-04 | §2.3 | Idle detection → away status bridge | UserActivityMonitor.ts | Todo | `feat-kevin-desktop-idle-status` |
| CALL-01 | §2.4 | Grant mic / camera permission | permissionsManager | Done | `feat-kevin-desktop-media-permission` |
| CALL-02 | §2.4 | Screenshare via `desktopCapturer` | callsWidgetWindow / desktopCapturer | Todo | `feat-kevin-desktop-screenshare` |
| CALL-03 | §2.4 | Separate Calls widget window | callsWidgetWindow.ts | Deferred | `feat-kevin-desktop-calls-widget` |
| PLAT-01 | §3 | Windows NSIS installer | electron-builder / nsis | Done | `feat-kevin-desktop-win-nsis` |
| PLAT-02 | §3 | macOS dmg installer | electron-builder / dmg | Done | `feat-kevin-desktop-mac-dmg` |
| PLAT-03 | §3 | Linux AppImage + deb | AppImage / deb | Done | `feat-kevin-desktop-linux-pack` |
| NOTI-01 | MM | Native OS notification | `src/main/notifications/` | Done | `feat-kevin-desktop-native-notify` |
| NOTI-02 | MM | Click notification → focus + open chat | navigationManager deep link | Done | `feat-kevin-desktop-notify-deeplink` |
| NOTI-03 | MM | Dock / taskbar unread badge | badge.ts | Todo | `feat-kevin-desktop-unread-badge` |
| NOTI-04 | MM | Tray icon unread / mention state | tray.ts + AppState | Partial | `feat-kevin-desktop-tray-badge` *(desktop IPC ready; web hook later)* |
| NOTI-05 | MM | Flash / bounce on mention (Win/mac) | notifications flash/bounce | Todo | `feat-kevin-desktop-attention` |
| SHELL-01 | MM / §3 | Electron window loads web client | BrowserWindow / WebContentsView | Done | `feat-kevin-desktop-shell-window` |
| SHELL-02 | MM | `contextIsolation` + no `nodeIntegration` | security defaults | Done | `feat-kevin-desktop-secure-prefs` |
| SHELL-03 | MM | Narrow preload bridge `qchatDesktop` | externalAPI preload | Done | `feat-kevin-desktop-preload-bridge` |
| SHELL-04 | MM | Renderer sandbox enabled | webPreferences.sandbox | Done | `feat-kevin-desktop-renderer-sandbox` |
| SHELL-05 | MM | Configurable web URL (`--url` / env / `.env`) | servers config | Done | `feat-kevin-desktop-web-url-config` |
| SHELL-06 | MM | Packaged default production URL | Config / production.json | Done | `feat-kevin-desktop-prod-url` |
| SHELL-07 | MM | End-user `userData/config.json` URL override | Config | Done | `feat-kevin-desktop-user-config` |
| SHELL-08 | MM | Start at `/login` | navigation | Done | `feat-kevin-desktop-start-login` |
| SHELL-09 | MM | Single-instance lock | requestSingleInstanceLock | Done | `feat-kevin-desktop-single-instance` |
| SHELL-10 | MM | Second instance focuses existing window | app second-instance | Done | `feat-kevin-desktop-focus-existing` |
| SHELL-11 | MM | External http(s) links → OS browser | shell.openExternal | Done | `feat-kevin-desktop-open-external` |
| SHELL-12 | MM | Failed web load → error dialog | ErrorView | Done | `feat-kevin-desktop-load-error` |
| SHELL-13 | MM | Persist window size / position | mainWindow bounds-info | Done | `feat-kevin-desktop-window-state` |
| SHELL-14 | MM | App icon (window / taskbar) | assets / tray icons | Done | `feat-kevin-desktop-app-icon` |
| SHELL-15 | MM | Window title locked to product name | mainWindow title | Done | `feat-kevin-desktop-window-title` |
| SHELL-16 | MM | About dialog | appMenu about | Done | `feat-kevin-desktop-about` |
| SHELL-17 | MM | Native app menu (Edit / View / Window) | `src/app/menus/` | Done | `feat-kevin-desktop-app-menu` |
| SHELL-18 | MM | Menu reload / zoom in-out-reset | view.ts zoom | Done | `feat-kevin-desktop-zoom-menu` |
| SHELL-19 | MM | Spellcheck in composer | spellChecker session | Done | `feat-kevin-desktop-spellcheck` |
| SHELL-20 | MM | Download → OS save dialog | downloadsManager | Done | `feat-kevin-desktop-download-save` |
| SHELL-21 | MM | Download completion notification | notifications/Download | Todo | `feat-kevin-desktop-download-notify` |
| SHELL-22 | MM | Right-click context menu | contextMenu.ts | Todo | `feat-kevin-desktop-context-menu` |
| SHELL-23 | MM | System tray icon | tray/tray.ts | Done | `feat-kevin-desktop-system-tray` |
| SHELL-24 | MM | Minimize / close to tray | minimizeToTray | Done | `feat-kevin-desktop-close-to-tray` |
| SHELL-25 | MM | Tray menu Show / Quit | menus/tray.ts | Done | `feat-kevin-desktop-tray-menu` |
| SHELL-26 | MM | Autostart on OS login | AutoLauncher.ts | Done | `feat-kevin-desktop-autostart` |
| SHELL-27 | MM | Hide on start (start minimized) | AutoLauncher hideOnStart | Todo | `feat-kevin-desktop-hide-on-start` |
| SHELL-28 | MM | Protocol handler `qchat://` | mattermost:// deep links | Todo | `feat-kevin-desktop-protocol-qchat` |
| SHELL-29 | MM | Open conversation from deep link | navigationManager | Todo | `feat-kevin-desktop-deeplink-chat` |
| SHELL-30 | MM | Certificate error trust/deny UI | certificateStore.ts | Todo | `feat-kevin-desktop-cert-dialog` |
| SHELL-31 | MM | Theme sync with OS | themeManager.ts | Todo | `feat-kevin-desktop-os-theme` |
| SHELL-32 | MM | Offline / reconnect banner (shell) | ErrorView / isOnline | Todo | `feat-kevin-desktop-offline-banner` |
| SHELL-33 | MM | Multi-server tabs | tabs / servers | Deferred | `feat-kevin-desktop-multi-server` |
| SHELL-34 | MM | Pop-out windows | popoutManager.ts | Deferred | `feat-kevin-desktop-popout` |
| SHELL-35 | MM | GPO / MDM enterprise config | policyConfigLoader | Deferred | `feat-kevin-desktop-gpo` |
| PACK-01 | MM / §3 | electron-builder project config | packaging | Done | `feat-kevin-desktop-builder-config` |
| PACK-02 | MM | Windows build via Wine Docker on Linux | builder:wine | Done | `feat-kevin-desktop-win-docker` |
| PACK-03 | MM | Bundle static `apps/web/out` offline | asar extraResources | Deferred | `feat-kevin-desktop-offline-web` |
| PACK-04 | MM | Windows Authenticode signing | code sign | Todo | `feat-kevin-desktop-win-sign` |
| PACK-05 | MM | macOS Developer ID + notarization | notarize | Todo | `feat-kevin-desktop-mac-notarize` |
| PACK-06 | MM | Auto-update (`electron-updater`) | updateNotifier | Todo | `feat-kevin-desktop-auto-update` |
| PACK-07 | MM | Ship without `--no-sandbox` | production hardening | Todo | `feat-kevin-desktop-prod-sandbox` |
| PACK-08 | MM | Crash / telemetry hooks | diagnostics | Deferred | `feat-kevin-desktop-crash-report` |

---

### Todo backlog (implement one row = one commit)

1. `NOTI-03` dock/taskbar badge  
2. `SHELL-28` `qchat://` protocol  
3. `SHELL-29` deep-link open chat  
4. `SHELL-27` hide on start  
5. Web hook for `NOTI-04` — call `qchatDesktop.setUnreadStatus({ unread, mentions })`  
6. `AUTH-03` `safeStorage`  
7. `CALL-02` screenshare  
8. `PACK-04`–`PACK-07` signing + auto-update + sandbox  
9. `SHELL-21` download notify · `SHELL-22` context menu · `SHELL-30` cert UI · `SHELL-31` OS theme · `SHELL-32` offline banner · `NOTI-05` attention · `AUTH-04` idle  

```text
pick one Todo row
→ git checkout -b <Slug>   # off master; do not merge master from agent
→ implement only that unit in apps/desktop/
→ ask before commit
```

### Code map

| Area | Path |
|---|---|
| Electron main | `apps/desktop/main.js` |
| Preload | `apps/desktop/preload.js` |
| URL config | `apps/desktop/config.js`, `production.json` |
| Packager | `apps/desktop/package.json` → `build`, `dist-win.sh` |
| Mattermost reference | `mattermost/mattermost-desktop/src/` |
