# Client downloads (web-served)

Place built Qchat installers here. The web app serves them at `/downloads/<file>`
and the download page reads `manifest.json`.

## Expected filenames (defaults)

| Platform | Typical artifact | Copy as |
|---|---|---|
| Windows | `apps/desktop/dist/qchat-desktop-Setup-0.1.0.exe` | `qchat-desktop-Setup-0.1.0.exe` |
| macOS | `apps/desktop/dist/qchat-desktop-0.1.0-*.dmg` | `qchat-desktop-0.1.0-x64.dmg` (or arm64) |
| Linux AppImage | `apps/desktop/dist/qchat-desktop-0.1.0-*.AppImage` | `qchat-desktop-0.1.0-x64.AppImage` |
| Linux deb | `apps/desktop/dist/qchat-desktop-0.1.0-*.deb` | `qchat-desktop-0.1.0-amd64.deb` |
| Android | EAS / Gradle APK | `qchat-mobile.apk` |
| iOS | App Store / TestFlight URL | set `storeUrl` in manifest (no binary) |

## Publish steps

1. Build clients (`npm run dist:win` / `dist:mac` / `dist:linux`, EAS mobile builds).
2. Copy binaries into this folder (or run `./scripts/publish-downloads.sh` from the repo root).
3. Edit `manifest.json`: set `version`, `file` names, `available: true`, optional `sizeBytes` / `storeUrl`.
4. Rebuild / redeploy the web app so `public/downloads` is included in the static export.

Do **not** commit large binaries unless your team wants them in git. Prefer copying onto the deploy host under the web root’s `downloads/` directory.
