# XinChat clients

XinChat is a second branded client for the same Qchat/Rchat backend API. **One account** works on both Rchat and XinChat (same phone + password); auth tokens use separate storage keys (`xinchat.*` vs `qchat.*`) so both web apps can coexist on one domain.

| App | Path | URL (production) |
|-----|------|------------------|
| Web | `apps/xin-web` | `https://<host>/xin/` |
| Mobile | `apps/xin-mobile` | Store listing (`com.xinchat.mobile`) |
| Desktop | `apps/xin-desktop` | Electron shell loading `/xin/` |

## UI (distinct from Rchat)

Emerald green theme (not Rchat Telegram blue): **DM Sans**, labeled nav rail with **XinChat** wordmark, floating card panels, squircle avatars, square green FAB, split login hero. Solid message bubbles with high-contrast text (no neon glow).

- **Web:** `src/app/xin-layout.css` + `globals.css` under `data-app="xinchat"`
- **Mobile:** `src/theme.ts`, pill tab bar accent borders

Icons: green **X** via `scripts/generate-xinchat-icons.py`.

```bash
make xin-icons
./deploy/redeploy.sh --xin-web --skip-env-check
```

## Dev

```bash
make xin-web          # http://localhost:3001/xin/
make xin-mobile       # Expo
make xin-desktop      # Electron + xin-web
```

## Release & stores

Full guide: [`docs/xinchat-release.md`](../docs/xinchat-release.md)

```bash
make publish-xin-full   # desktop feed + downloads + redeploy + smoke
```

Download page: `/xin/download` · Auto-update: `/xin-desktop-updates/`

## Shared backend

All XinChat apps use the same `/v1/` API, WebSocket, and LiveKit stack as Rchat.
