const fs = require("fs");
const path = require("path");
const { app, shell, Notification } = require("electron");
const {
  APP_TITLE,
  APP_ID,
  TOAST_ACTIVATOR_CLSID,
} = require("../../shared/constants");
const { getIconPath } = require("../app/configuration/paths");

function normalizeClsid(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^\{/, "")
    .replace(/\}$/, "");
  return raw ? `{${raw}}` : "";
}

/**
 * Windows Action Center only lists apps that have a Start Menu .lnk whose
 * AppUserModelID and ToastActivatorCLSID match the running process.
 * Without that shortcut (or with a mismatched CLSID), Electron
 * Notification.show() is a silent no-op on Windows 11.
 *
 * Needed for both `npm start` (electron.exe) and installed NSIS builds.
 *
 * @returns {{ ok: boolean, clsidChanged: boolean }}
 */
function ensureWindowsToastShortcut() {
  if (process.platform !== "win32") return { ok: false, clsidChanged: false };

  try {
    app.setAppUserModelId(APP_ID);
    app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);

    const programs = path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    );
    fs.mkdirSync(programs, { recursive: true });

    const shortcutPath = path.join(programs, `${APP_TITLE}.lnk`);
    const iconPath = getIconPath();
    const toastClsid = normalizeClsid(app.toastActivatorCLSID || TOAST_ACTIVATOR_CLSID);

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
      cwd: path.dirname(process.execPath),
      description: APP_TITLE,
      appUserModelId: APP_ID,
      toastActivatorClsid: toastClsid,
    };

    if (!app.isPackaged) {
      // electron.exe must be launched with the app directory as argv[1].
      const appPath = path.resolve(app.getAppPath());
      details.args = `"${appPath}"`;
      details.cwd = appPath;
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
      return { ok: false, clsidChanged: false };
    }

    const clsidChanged = Boolean(previousClsid) && previousClsid !== toastClsid;
    console.log(
      "[qchat-desktop] Windows toast shortcut ready:",
      shortcutPath,
      `(${APP_ID}, ${toastClsid})`
    );
    return { ok: true, clsidChanged };
  } catch (err) {
    console.warn("[qchat-desktop] Windows toast shortcut error:", err);
    return { ok: false, clsidChanged: false };
  }
}

/**
 * Fire one silent toast so Windows registers the sender under
 * Settings → Notifications (app only appears after a successful notify).
 * @param {{ force?: boolean }} [opts]
 */
function primeWindowsToastOnce(opts = {}) {
  if (process.platform !== "win32") return;
  if (!Notification.isSupported()) return;

  const flagPath = path.join(app.getPath("userData"), "windows-toast-primed");
  try {
    if (!opts.force && fs.existsSync(flagPath)) return;
  } catch {
    return;
  }

  try {
    const iconPath = getIconPath();
    const notification = new Notification({
      title: APP_TITLE,
      body: "Desktop notifications are enabled.",
      silent: true,
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    });
    notification.on("failed", (_e, error) => {
      console.warn("[qchat-desktop] prime toast failed event:", error);
      try {
        fs.unlinkSync(flagPath);
      } catch {
        /* ignore */
      }
    });
    notification.show();
    fs.writeFileSync(flagPath, String(Date.now()));
  } catch (err) {
    console.warn("[qchat-desktop] prime toast failed:", err);
  }
}

/** Call after app.whenReady() on Windows. */
function registerWindowsNotifications() {
  if (process.platform !== "win32") return;
  const { ok, clsidChanged } = ensureWindowsToastShortcut();
  if (!ok) return;
  // Re-prime when the activator CLSID was repaired so Action Center rebinds.
  primeWindowsToastOnce({ force: clsidChanged });
}

module.exports = {
  ensureWindowsToastShortcut,
  primeWindowsToastOnce,
  registerWindowsNotifications,
};
