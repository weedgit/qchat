const fs = require("fs");
const path = require("path");
const { app, shell, Notification } = require("electron");
const { APP_TITLE, APP_ID } = require("../../shared/constants");
const { getIconPath } = require("../app/configuration/paths");

/**
 * Windows Action Center only lists apps that have a Start Menu .lnk whose
 * AppUserModelID matches app.setAppUserModelId(). Without that shortcut,
 * Electron Notification.show() is a no-op and Qchat never appears under
 * Settings → System → Notifications.
 *
 * Needed for both `npm start` (electron.exe) and installed NSIS builds.
 *
 * @returns {boolean}
 */
function ensureWindowsToastShortcut() {
  if (process.platform !== "win32") return false;

  try {
    ensureWindowsAppUserModelId();

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

    /** @type {Electron.ShortcutDetails} */
    const details = {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      description: APP_TITLE,
      appUserModelId: APP_ID,
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
    } else {
      console.log(
        "[qchat-desktop] Windows toast shortcut ready:",
        shortcutPath,
        `(${APP_ID})`
      );
    }
    return ok;
  } catch (err) {
    console.warn("[qchat-desktop] Windows toast shortcut error:", err);
    return false;
  }
}

/** Re-apply AUMID before each toast (cheap; required for reliable Win32 notify). */
function ensureWindowsAppUserModelId() {
  if (process.platform !== "win32") return;
  try {
    app.setAppUserModelId(APP_ID);
  } catch (err) {
    console.warn("[qchat-desktop] setAppUserModelId failed:", err?.message || err);
  }
}

/** Retained so the prime toast is not garbage-collected before it shows. */
let primeNotification = null;

/**
 * Fire one silent toast so Windows registers the sender under
 * Settings → Notifications (app only appears after a successful notify).
 * Persist the primed flag only after the toast actually shows.
 */
function primeWindowsToastOnce() {
  if (process.platform !== "win32") return;
  if (!Notification.isSupported()) return;

  const flagPath = path.join(app.getPath("userData"), "windows-toast-primed");
  try {
    if (fs.existsSync(flagPath)) return;
  } catch {
    return;
  }

  try {
    ensureWindowsAppUserModelId();
    const iconPath = getIconPath();
    const notification = new Notification({
      title: APP_TITLE,
      body: "Desktop notifications are enabled.",
      silent: true,
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    });
    primeNotification = notification;
    notification.on("show", () => {
      try {
        fs.writeFileSync(flagPath, String(Date.now()));
      } catch (err) {
        console.warn("[qchat-desktop] could not persist toast prime flag:", err);
      }
    });
    notification.on("close", () => {
      primeNotification = null;
    });
    notification.on("failed", (_e, error) => {
      primeNotification = null;
      console.warn("[qchat-desktop] prime toast failed:", error);
    });
    notification.show();
  } catch (err) {
    console.warn("[qchat-desktop] prime toast error:", err);
  }
}

/** Call after app.whenReady() on Windows. */
function registerWindowsNotifications() {
  if (process.platform !== "win32") return;
  const ok = ensureWindowsToastShortcut();
  if (ok) primeWindowsToastOnce();
}

module.exports = {
  ensureWindowsToastShortcut,
  ensureWindowsAppUserModelId,
  primeWindowsToastOnce,
  registerWindowsNotifications,
};
