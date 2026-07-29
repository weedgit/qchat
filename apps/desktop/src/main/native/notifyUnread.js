const { Notification, app } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const {
  shouldUseMacToastFallback,
  showMacToastNotification,
} = require("./macNotify");

/** @type {number} */
let lastToastAt = 0;

function markDesktopToastShown() {
  lastToastAt = Date.now();
}

function recentlyToasted(withinMs = 4000) {
  return Date.now() - lastToastAt < withinMs;
}

/**
 * Backup toast when unread/mentions rise while the shell is in the background.
 * Covers remote web builds that never invoke notifyMessage, or swallow IPC errors.
 *
 * @param {{ unread: number, mentions: number }} status
 * @param {{ getMainWindow?: () => Electron.BrowserWindow | null }} deps
 */
function maybeNotifyFromUnread(status, deps = {}) {
  const win =
    typeof deps.getMainWindow === "function" ? deps.getMainWindow() : null;
  const windowActive =
    Boolean(win) &&
    !win.isDestroyed() &&
    win.isVisible() &&
    !win.isMinimized() &&
    win.isFocused();

  if (windowActive) return false;
  if (recentlyToasted()) return false;
  if (!Notification.isSupported() && !shouldUseMacToastFallback()) return false;

  const unread = Number(status.unread) || 0;
  const mentions = Number(status.mentions) || 0;
  if (unread <= 0 && mentions <= 0) return false;

  const title = APP_TITLE;
  const body =
    mentions > 0
      ? `You have ${mentions} unread mention${mentions === 1 ? "" : "s"}`
      : `You have ${unread} unread message${unread === 1 ? "" : "s"}`;

  const onClick = () => {
    console.log("[qchat-desktop] unread toast clicked — focusing main window");
    if (process.platform === "darwin") {
      try {
        app.show();
      } catch {
        /* ignore */
      }
      try {
        if (typeof app.focus === "function") app.focus({ steal: true });
      } catch {
        /* ignore */
      }
    }
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      try {
        win.moveTop();
      } catch {
        /* ignore */
      }
      win.show();
      win.focus();
      try {
        win.webContents?.focus?.();
      } catch {
        /* ignore */
      }
    }
  };

  if (shouldUseMacToastFallback()) {
    console.log("[qchat-desktop] show unread backup toast (mac window):", {
      unread,
      mentions,
    });
    void showMacToastNotification({
      title,
      body,
      silent: false,
      onClick,
    }).then((ok) => {
      if (ok) {
        console.log(
          "[qchat-desktop] unread backup toast shown (mac window):",
          body
        );
        markDesktopToastShown();
      }
    });
    markDesktopToastShown();
    return true;
  }

  try {
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.on("click", onClick);
    notification.on("show", () => {
      console.log("[qchat-desktop] unread backup toast shown:", body);
      markDesktopToastShown();
      if (win && !win.isDestroyed() && process.platform === "win32") {
        try {
          win.flashFrame(true);
        } catch {
          /* ignore */
        }
      }
    });
    notification.on("failed", (_e, error) => {
      const msg = String(error || "");
      console.warn("[qchat-desktop] unread backup toast failed:", msg);
      if (
        process.platform === "darwin" &&
        /UNErrorDomain|NotificationsNotAllowed/i.test(msg)
      ) {
        console.warn(
          "[qchat-desktop] macOS notifications need a signed Electron.app — run: npm run sign:dev"
        );
      }
    });
    console.log("[qchat-desktop] show unread backup toast:", { unread, mentions });
    notification.show();
    markDesktopToastShown();
    return true;
  } catch (err) {
    console.warn("[qchat-desktop] unread backup toast error:", err);
    return false;
  }
}

module.exports = {
  markDesktopToastShown,
  recentlyToasted,
  maybeNotifyFromUnread,
};
