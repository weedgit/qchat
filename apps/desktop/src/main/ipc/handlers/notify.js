const fs = require("fs");
const os = require("os");
const path = require("path");
const { Notification } = require("electron");
const { APP_TITLE } = require("../../../shared/constants");
const {
  getIconPath,
  getIconPngPath,
  getDesktopRoot,
} = require("../../app/configuration/paths");
const { requestWindowAttention } = require("../../native/attention");
const {
  shouldUseMacToastFallback,
  showMacToastNotification,
} = require("../../native/macNotify");

function isWindows10OrNewer() {
  if (process.platform !== "win32") return false;
  // Windows 10+ releases start at 10.0.x (Mattermost Mention.ts).
  const release = String(os.release() || "");
  const parts = release.split(".").map((p) => parseInt(p, 10) || 0);
  return parts[0] > 10 || (parts[0] === 10 && parts[1] >= 0);
}

/**
 * Mattermost-style toast options:
 * On macOS and Windows 10+, Notification Center already shows the app icon from
 * the Start Menu shortcut — passing another icon duplicates or can fail the toast.
 */
function buildNotificationOptions(title, body, silent) {
  /** @type {Electron.NotificationConstructorOptions} */
  const options = {
    title,
    body,
    silent: Boolean(silent),
    urgency: "normal",
  };

  if (process.platform === "darwin" || isWindows10OrNewer()) {
    return options;
  }

  const icon48 = path.join(getDesktopRoot(), "assets", "icon-48.png");
  const iconPath = fs.existsSync(icon48)
    ? icon48
    : fs.existsSync(getIconPngPath())
      ? getIconPngPath()
      : getIconPath();
  if (fs.existsSync(iconPath)) {
    options.icon = iconPath;
  }
  return options;
}

/**
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 * @param {(id: string) => void} deps.sendConversationToRenderer
 * @param {() => Electron.BrowserWindow | null} [deps.getMainWindow]
 */
function createNotifyHandler(deps) {
  return async (_event, payload) => {
    if (!Notification.isSupported()) {
      console.warn("[qchat-desktop] notification not supported");
      return false;
    }
    if (!payload || typeof payload !== "object") return false;

    const title = String(payload.title || APP_TITLE);
    const body = String(payload.body || "").trim() || "New message";
    const conversationId = String(payload.conversationId || "");
    const isMention = Boolean(payload.mention || payload.attention);
    // True when the renderer considers this the open conversation.
    const viewingConversation = Boolean(payload.suppressIfFocused);

    const win =
      typeof deps.getMainWindow === "function" ? deps.getMainWindow() : null;

    // Skip whenever the shell is focused and visible — user asked for toasts
    // only when closed / minimized / unfocused (not while using the app).
    const windowActive =
      Boolean(win) &&
      !win.isDestroyed() &&
      win.isVisible() &&
      !win.isMinimized() &&
      win.isFocused();

    if (windowActive) {
      console.log(
        "[qchat-desktop] skip toast — window focused:",
        conversationId || "(no conversation)",
        viewingConversation ? "(viewing this chat)" : ""
      );
      return false;
    }

    console.log("[qchat-desktop] show toast:", {
      title,
      conversationId,
      viewingConversation,
      windowActive,
    });

    if (isMention && typeof deps.getMainWindow === "function") {
      requestWindowAttention(deps.getMainWindow, { mention: true });
    }

    // Unpackaged macOS: native UNNotification often never banners. Show an
    // always-on-top toast window instead of dock-bounce / Script Editor.
    if (shouldUseMacToastFallback()) {
      try {
        const { markDesktopToastShown } = require("../../native/notifyUnread");
        markDesktopToastShown();
      } catch {
        /* ignore */
      }
      const ok = await showMacToastNotification({
        title,
        body,
        silent: Boolean(payload.silent),
        onClick: () => {
          deps.focusMainWindow();
          deps.sendConversationToRenderer(conversationId);
        },
      });
      if (ok) {
        console.log("[qchat-desktop] message toast shown (mac window):", title);
      }
      return ok;
    }

    try {
      const notification = new Notification(
        buildNotificationOptions(title, body, payload.silent)
      );
      notification.on("click", () => {
        deps.focusMainWindow();
        deps.sendConversationToRenderer(conversationId);
      });
      notification.on("show", () => {
        console.log("[qchat-desktop] message toast shown:", title);
        try {
          const { markDesktopToastShown } = require("../../native/notifyUnread");
          markDesktopToastShown();
        } catch {
          /* ignore */
        }
        if (process.platform === "win32" && win && !win.isDestroyed()) {
          try {
            win.flashFrame(true);
          } catch {
            /* ignore */
          }
        }
        if (isMention && typeof deps.getMainWindow === "function") {
          requestWindowAttention(deps.getMainWindow, { mention: true });
        }
      });
      notification.on("failed", (_e, error) => {
        const msg = String(error || "");
        console.warn("[qchat-desktop] notification failed:", msg);
        if (
          process.platform === "darwin" &&
          /UNErrorDomain|NotificationsNotAllowed/i.test(msg)
        ) {
          console.warn(
            "[qchat-desktop] macOS UNNotification requires a signed Electron.app. " +
              "Quit and re-run npm start (auto sign:dev), or: npm run sign:dev"
          );
        }
      });
      notification.show();
      return true;
    } catch (err) {
      console.warn("[qchat-desktop] notification error:", err);
      return false;
    }
  };
}

module.exports = { createNotifyHandler, buildNotificationOptions };
