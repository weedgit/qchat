const fs = require("fs");
const { Notification } = require("electron");
const { APP_TITLE } = require("../../../shared/constants");
const { getIconPath } = require("../../app/configuration/paths");
const { requestWindowAttention } = require("../../native/attention");
const { ensureWindowsAppUserModelId } = require("../../native/windowsNotifications");

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
      notification.on("click", () => {
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
      notification.on("failed", (_e, error) => {
        console.warn("[qchat-desktop] notification failed:", error);
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
