# XinChat download assets

Installers served at `https://<host>/xin/downloads/<file>` after web deploy.

## Copy builds here

| File | Source |
|------|--------|
| `xinchat-desktop-Setup-*.exe` | `apps/xin-desktop/dist/` (Windows) |
| `xinchat-desktop-*-arm64.dmg` | `apps/xin-desktop/dist/` (macOS) |
| `xinchat-desktop-*.AppImage` | `apps/xin-desktop/dist/` (Linux) |
| `xinchat-mobile.apk` | EAS preview/production APK |

**Only XinChat artifacts** — do not copy Rchat `qchat-*` files here.

Or run from repo root:

```bash
./scripts/sync-xin-installers.sh
```

Then set `available: true` and `sizeBytes` in `manifest.json` (or let sync script update sizes).

Rebuild XinChat web: `./deploy/redeploy.sh --xin-web --skip-env-check`

**Do not commit** large binaries — they are gitignored. Use `sync-xin-installers.sh` on the deploy host.

## Images

Hero/marketing images live in `images/` (shared with Rchat layout). Brand icon uses `/xin/icons/icon-192.png` in the download page header.
