const { updateTrayUnreadStatus } = require("../../native/trayStatus");
const { updateAppBadge } = require("../../native/badge");

/**
 * Tray tooltip/title (NOTI-04) + dock/taskbar badge (NOTI-03).
 * Same IPC payload drives both so web only calls setUnreadStatus once.
 *
 * @param {{ getMainWindow: () => Electron.BrowserWindow | null }} deps
 */
function createUnreadStatusHandler(deps) {
  return async (_event, payload) => {
    const normalized =
      payload != null && typeof payload === "object"
        ? /** @type {{ unread?: number | boolean, mentions?: number }} */ (payload)
        : { unread: 0, mentions: 0 };

    const status = updateTrayUnreadStatus(normalized);
    try {
      await updateAppBadge(status, { getMainWindow: deps.getMainWindow });
    } catch (err) {
      console.warn("[qchat-desktop] app badge update failed:", err?.message || err);
    }
    return true;
  };
}

module.exports = { createUnreadStatusHandler };
