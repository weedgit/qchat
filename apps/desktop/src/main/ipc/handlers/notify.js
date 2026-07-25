const fs = require("fs");
const { Notification } = require("electron");
const { APP_TITLE } = require("../../../shared/constants");
const { getIconPath } = require("../../app/configuration/paths");
const { requestWindowAttention } = require("../../native/attention");

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
    const body = String(payload.body || "").trim() || "New message";
    const conversationId = String(payload.conversationId || "");
    const isMention = Boolean(payload.mention || payload.attention);
    const suppressIfFocused = Boolean(payload.suppressIfFocused);
    const iconPath = getIconPath();

    const win =
      typeof deps.getMainWindow === "function" ? deps.getMainWindow() : null;

    // Prefer OS window focus over document.hasFocus() (unreliable in Electron).
    if (
      suppressIfFocused &&
      win &&
      !win.isDestroyed() &&
      win.isFocused() &&
      !win.isMinimized()
    ) {
      return false;
    }

    // NOTI-05: flash / bounce for mentions even if OS notification is blocked later.
    if (isMention && win) {
      requestWindowAttention(() => win, { mention: true });
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
        deps.sendConversationToRenderer(conversationId);
      });
      notification.on("show", () => {
        console.log("[qchat-desktop] message toast shown:", title);
        if (isMention && win) {
          requestWindowAttention(() => win, { mention: true });
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
