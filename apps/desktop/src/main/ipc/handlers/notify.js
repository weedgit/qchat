const fs = require("fs");
const { Notification } = require("electron");
const { APP_TITLE } = require("../../../shared/constants");
const { getIconPath } = require("../../app/configuration/paths");

/**
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 * @param {(id: string) => void} deps.sendConversationToRenderer
 */
function createNotifyHandler(deps) {
  return async (_event, payload) => {
    if (!Notification.isSupported()) return false;
    if (!payload || typeof payload !== "object") return false;

    const title = String(payload.title || APP_TITLE);
    const body = String(payload.body || "");
    const conversationId = String(payload.conversationId || "");
    const iconPath = getIconPath();

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
    notification.show();
    return true;
  };
}

module.exports = { createNotifyHandler };
