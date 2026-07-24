const fs = require("fs");
const { Notification } = require("electron");
const { APP_TITLE } = require("../../../shared/constants");
const { getIconPath } = require("../../app/configuration/paths");
const { requestWindowAttention } = require("../../native/attention");
const { ensureWindowsAppUserModelId } = require("../../native/windowsNotifications");

/**
 * Keep every live Notification referenced until it is clicked, closed, or
 * fails. Without a retained reference the object can be garbage-collected
 * right after the IPC handler returns and the OS toast silently never shows
 * (Mattermost keeps an allActiveNotifications map for the same reason).
 * Keyed by conversation so Windows shows only the latest toast per chat.
 * @type {Map<string, Electron.Notification>}
 */
const activeNotifications = new Map();
let notificationSeq = 0;

/** Windows toasts stack per conversation — dismiss the older one first. */
function closePreviousForConversation(key) {
  const previous = activeNotifications.get(key);
  if (!previous) return;
  activeNotifications.delete(key);
  try {
    previous.close();
  } catch {
    /* already gone */
  }
}

/**
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 * @param {(id: string) => void} deps.sendConversationToRenderer
 * @param {() => Electron.BrowserWindow | null} [deps.getMainWindow]
 */
function createNotifyHandler(deps) {
  return async (_event, payload) => {
    if (!Notification.isSupported()) return false;
    if (!payload || typeof payload !== "object") return false;

    const title = String(payload.title || APP_TITLE);
    const body = String(payload.body || "");
    const conversationId = String(payload.conversationId || "");
    const isMention = Boolean(payload.mention || payload.attention);
    const iconPath = getIconPath();

    // Win32 toasts require a matching AppUserModelID on the process.
    ensureWindowsAppUserModelId();

    // NOTI-05: flash / bounce for mentions even if OS notification is blocked later.
    if (isMention && typeof deps.getMainWindow === "function") {
      requestWindowAttention(deps.getMainWindow, { mention: true });
    }

    try {
      const notification = new Notification({
        title,
        body,
        silent: Boolean(payload.silent),
        ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
      });

      const key = conversationId || `notify-${++notificationSeq}`;
      closePreviousForConversation(key);
      activeNotifications.set(key, notification);
      const release = () => {
        if (activeNotifications.get(key) === notification) {
          activeNotifications.delete(key);
        }
      };

      notification.on("click", () => {
        release();
        deps.focusMainWindow();
        if (conversationId) {
          deps.sendConversationToRenderer(conversationId);
        }
      });
      notification.on("show", () => {
        if (isMention && typeof deps.getMainWindow === "function") {
          requestWindowAttention(deps.getMainWindow, { mention: true });
        }
      });
      notification.on("close", release);
      notification.on("failed", (_e, error) => {
        release();
        const message = String(error || "");
        if (message.includes("HRESULT:-2143420143")) {
          // Windows Settings → Notifications has this app (or all toasts) off.
          console.warn(
            "[qchat-desktop] notifications are disabled in Windows settings"
          );
        } else {
          console.warn("[qchat-desktop] notification failed:", message);
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

module.exports = { createNotifyHandler };
