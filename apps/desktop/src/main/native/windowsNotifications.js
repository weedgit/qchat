const fs = require("fs");
const path = require("path");
const { app, shell, Notification } = require("electron");
const {
  APP_TITLE,
  APP_ID,
  TOAST_ACTIVATOR_CLSID,
} = require("../../shared/constants");
const { getIconPath, getIconPngPath } = require("../app/configuration/paths");

function normalizeClsid(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^\{/, "")
    .replace(/\}$/, "");
  return raw ? `{${raw}}` : "";
}

function startMenuProgramsDir() {
  return path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );
}

function qchatShortcutPath() {
  return path.join(startMenuProgramsDir(), `${APP_TITLE}.lnk`);
}

/**
 * Electron's built-in toast activator also writes a Start Menu .lnk named after
 * GetApplicationName(). For unpackaged electron.exe that name is often
 * "Electron", so Windows Settings lists banners under "Electron" instead of
 * Qchat. Remove those conflicting shortcuts when they point at our binary.
 */
function removeConflictingElectronShortcuts() {
  const programs = startMenuProgramsDir();
  let removed = false;
  try {
    if (!fs.existsSync(programs)) return false;
    const execPath = path.normalize(process.execPath).toLowerCase();
    for (const name of fs.readdirSync(programs)) {
      if (!/\.lnk$/i.test(name)) continue;
      if (name.toLowerCase() === `${APP_TITLE}.lnk`.toLowerCase()) continue;
      // Only strip the generic Electron shortcut Electron itself creates.
      if (!/^electron\.lnk$/i.test(name)) continue;
      const full = path.join(programs, name);
      try {
        const details = shell.readShortcutLink(full);
        const target = path.normalize(String(details.target || "")).toLowerCase();
        const aumid = String(details.appUserModelId || "");
        if (target === execPath || aumid === APP_ID) {
          fs.unlinkSync(full);
          removed = true;
          console.log("[qchat-desktop] removed conflicting toast shortcut:", full);
        }
      } catch {
        /* ignore unreadable lnk */
      }
    }
  } catch (err) {
    console.warn(
      "[qchat-desktop] failed cleaning Electron toast shortcuts:",
      err?.message || err
    );
  }
  return removed;
}

/** Help Settings → Notifications show "Qchat Desktop" for our AUMID. */
function registerAppUserModelDisplayName() {
  if (process.platform !== "win32") return;
  try {
    const { execFileSync } = require("child_process");
    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
    execFileSync(
      "reg",
      ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", APP_TITLE, "/f"],
      { windowsHide: true, stdio: "ignore" }
    );
    const iconPath = getIconPath();
    if (fs.existsSync(iconPath)) {
      execFileSync(
        "reg",
        ["add", key, "/v", "IconUri", "/t", "REG_SZ", "/d", iconPath, "/f"],
        { windowsHide: true, stdio: "ignore" }
      );
    }
  } catch (err) {
    console.warn(
      "[qchat-desktop] AppUserModelId DisplayName registry failed:",
      err?.message || err
    );
  }
}

/**
 * Windows Action Center only lists apps that have a Start Menu .lnk whose
 * AppUserModelID and ToastActivatorCLSID match the running process.
 *
 * Keep cwd = dirname(electron.exe) so Electron's own EnsureShortcut() treats
 * our .lnk as valid and does not replace it with Electron.lnk (empty args).
 *
 * @returns {{ ok: boolean, clsidChanged: boolean, conflictRemoved: boolean }}
 */
function ensureWindowsToastShortcut() {
  if (process.platform !== "win32") {
    return { ok: false, clsidChanged: false, conflictRemoved: false };
  }

  try {
    // Prefer our product title so any Electron-managed rewrite uses this name.
    try {
      app.setName(APP_TITLE);
    } catch {
      /* ignore */
    }
    app.setAppUserModelId(APP_ID);
    app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
    registerAppUserModelDisplayName();

    const programs = startMenuProgramsDir();
    fs.mkdirSync(programs, { recursive: true });

    const shortcutPath = qchatShortcutPath();
    // Prefer PNG for .lnk icon — hand-rolled .ico failed Electron setIcon on Win11.
    const iconPng = getIconPngPath();
    const iconPath = fs.existsSync(iconPng) ? iconPng : getIconPath();
    const toastClsid = normalizeClsid(
      app.toastActivatorCLSID || TOAST_ACTIVATOR_CLSID
    );
    const electronDir = path.dirname(process.execPath);

    let previousClsid = "";
    if (fs.existsSync(shortcutPath)) {
      try {
        previousClsid = normalizeClsid(
          shell.readShortcutLink(shortcutPath).toastActivatorClsid
        );
      } catch {
        previousClsid = "";
      }
    }

    /** @type {Electron.ShortcutDetails} */
    const details = {
      target: process.execPath,
      // Must match Electron EnsureShortcut expected_working_dir or it rewrites
      // the activator shortcut as Electron.lnk and Settings shows "Electron".
      cwd: electronDir,
      description: APP_TITLE,
      appUserModelId: APP_ID,
      toastActivatorClsid: toastClsid,
    };

    if (!app.isPackaged) {
      // electron.exe must be launched with the app directory as argv[1].
      const appPath = path.resolve(app.getAppPath());
      details.args = `"${appPath}"`;
    }

    if (fs.existsSync(iconPath)) {
      details.icon = iconPath;
      details.iconIndex = 0;
    }

    const operation = fs.existsSync(shortcutPath) ? "update" : "create";
    const ok = shell.writeShortcutLink(shortcutPath, operation, details);
    if (!ok) {
      console.warn(
        "[qchat-desktop] failed to write Start Menu shortcut for Windows toasts:",
        shortcutPath
      );
      return { ok: false, clsidChanged: false, conflictRemoved: false };
    }

    const conflictRemoved = removeConflictingElectronShortcuts();
    const clsidChanged = Boolean(previousClsid) && previousClsid !== toastClsid;
    console.log(
      "[qchat-desktop] Windows toast shortcut ready:",
      shortcutPath,
      `(${APP_ID}, ${toastClsid})`
    );
    return { ok: true, clsidChanged, conflictRemoved };
  } catch (err) {
    console.warn("[qchat-desktop] Windows toast shortcut error:", err);
    return { ok: false, clsidChanged: false, conflictRemoved: false };
  }
}

/**
 * Fire one toast so Windows registers the sender under Settings → Notifications.
 * Mattermost-style: no per-toast icon on Windows 10+ (Start Menu app icon is used).
 * @param {{ force?: boolean }} [opts]
 */
function primeWindowsToastOnce(opts = {}) {
  if (process.platform !== "win32") return;
  if (!Notification.isSupported()) return;

  const flagPath = path.join(app.getPath("userData"), "windows-toast-primed-v2");
  try {
    if (!opts.force && fs.existsSync(flagPath)) return;
  } catch {
    return;
  }

  try {
    try {
      fs.unlinkSync(path.join(app.getPath("userData"), "windows-toast-primed"));
    } catch {
      /* ignore */
    }
    // Do not pass icon on Win10+ — matches Mattermost Mention.ts and avoids
    // toast failures from a bad/hand-rolled .ico path.
    const notification = new Notification({
      title: APP_TITLE,
      body: "Desktop notifications are enabled.",
      silent: false,
    });
    notification.on("failed", (_e, error) => {
      console.warn("[qchat-desktop] prime toast failed event:", error);
      try {
        fs.unlinkSync(flagPath);
      } catch {
        /* ignore */
      }
    });
    notification.on("show", () => {
      console.log("[qchat-desktop] prime toast shown");
    });
    notification.show();
    fs.writeFileSync(flagPath, String(Date.now()));
  } catch (err) {
    console.warn("[qchat-desktop] prime toast failed:", err);
  }
}

/**
 * Electron registers its toast activator asynchronously after the first
 * Notification; that pass often recreates Electron.lnk. Re-assert ours after.
 */
function reassertWindowsToastShortcutSoon() {
  if (process.platform !== "win32") return;
  const delays = [1500, 4000, 8000];
  for (const ms of delays) {
    setTimeout(() => {
      try {
        const { ok, conflictRemoved } = ensureWindowsToastShortcut();
        if (ok && conflictRemoved) {
          primeWindowsToastOnce({ force: true });
        }
      } catch (err) {
        console.warn(
          "[qchat-desktop] toast shortcut reassert failed:",
          err?.message || err
        );
      }
    }, ms);
  }
}

/** Call after app.whenReady() on Windows. */
function registerWindowsNotifications() {
  if (process.platform !== "win32") return;
  const { ok, clsidChanged, conflictRemoved } = ensureWindowsToastShortcut();
  if (!ok) return;
  // Re-prime when CLSID was repaired or Electron.lnk was removed so Settings
  // rebinds under "Qchat Desktop". Also primes once via windows-toast-primed-v2.
  primeWindowsToastOnce({ force: clsidChanged || conflictRemoved });
  reassertWindowsToastShortcutSoon();
}

module.exports = {
  ensureWindowsToastShortcut,
  primeWindowsToastOnce,
  registerWindowsNotifications,
  removeConflictingElectronShortcuts,
};
