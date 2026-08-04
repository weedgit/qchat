# Qchat architecture

## Monorepo layout

| Layer | Rchat | XinChat | Shared |
|-------|-------|---------|--------|
| Web UI | `apps/web` → `/` | `apps/xin-web` → `/xin/` | Same `/v1/` API |
| Mobile | `apps/mobile` (`com.qchat.mobile`) | `apps/xin-mobile` (`com.xinchat.mobile`) | Same accounts |
| Desktop | `apps/desktop` | `apps/xin-desktop` | Electron shells |
| Admin | `apps/admin` → `/admin/` | — | — |
| API | `services/api` | — | Go monolith + WS |
| i18n | `packages/i18n` | — | — |

XinChat is a branded client only — no separate user database. Auth tokens use different localStorage keys (`qchat.*` vs `xinchat.*`) so both web apps can run on one host.

Deploy: [`deployment-nginx-systemd.md`](./deployment-nginx-systemd.md) · XinChat release: [`xinchat-release.md`](./xinchat-release.md)

---

## Desktop shell (Electron)

Thin shell around the **web** client (`apps/web` or `apps/xin-desktop` loading `apps/xin-web`), using main / preload / shared separation — no embedded local React UI.

### Process diagram

```mermaid
flowchart LR
    UI["Renderer: web app in BrowserWindow"]
    PRELOAD["Preload: src/preload"]
    MAIN["Main: src/main"]
    SHARED["Shared: src/shared IPC contracts"]
    API["Go Backend REST /v1"]
    WS["Go Backend WebSocket"]
    OS["OS: notify, dialogs, shell"]

    UI --> API
    UI <--> WS
    UI --> PRELOAD
    PRELOAD <--> MAIN
    MAIN --> SHARED
    PRELOAD --> SHARED
    MAIN --> OS
    MAIN -->|"same-origin captcha fetch"| API
```

### Responsibilities

| Layer | Path | Responsibility |
|---|---|---|
| **Main** | `src/main/` | App lifecycle, `BrowserWindow`, menus, notifications, downloads, permissions, navigation guards, IPC handlers |
| **Preload** | `src/preload/` | Narrow `contextBridge` — `window.qchatDesktop` or `window.xinchatDesktop` |
| **Shared** | `src/shared/` | IPC channel names + app constants |
| **Renderer** | remote web app | All chat UI, REST, WebSocket, auth tokens in web storage |
| **Go backend** | `services/api` | Unchanged; desktop must not alter API contracts |

Rchat desktop: `apps/desktop` · XinChat desktop: `apps/xin-desktop` (same structure, different `production.json` and bridge name).

### Folder tree (Rchat)

```text
apps/desktop/
├── assets/
├── production.json
├── package.json
├── src/main/
├── src/preload/
└── src/shared/
```

See [`apps/desktop/README.md`](../apps/desktop/README.md) and [`desktop-feature-status.md`](./desktop-feature-status.md).

### IPC data flow

1. Web calls `window.qchatDesktop.notifyMessage(payload)` (or `xinchatDesktop`).
2. Preload `invoke`s a channel from `shared/ipc/channels`.
3. Main handler shows `Notification`; click focuses window and opens the conversation.

### REST / WebSocket

Chat REST and WebSocket stay in the web renderer. Desktop main only performs captcha `GET` to avoid renderer CORS issues.

### Auth / tokens

Tokens remain in the web renderer (localStorage). Preload does not expose tokens or generic IPC.

### Security settings

```js
contextIsolation: true
nodeIntegration: false
sandbox: true
```

External navigations open in the OS browser.

### Adding a new IPC method

1. Add channel name to `src/shared/ipc/channels.js`.
2. Add handler under `src/main/ipc/handlers/`.
3. Expose one function in `src/preload/index.js`.
4. Coordinate web changes in `apps/web` or `apps/xin-web` if needed.
