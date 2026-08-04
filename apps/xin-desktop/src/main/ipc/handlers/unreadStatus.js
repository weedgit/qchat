const { updateTrayUnreadStatus, getTrayUnreadStatus } = require("../../native/trayStatus");
const { updateAppBadge } = require("../../native/badge");
const { maybeNotifyFromUnread } = require("../../native/notifyUnread");

/**
 * Tray tooltip/title (NOTI-04) + dock/taskbar badge (NOTI-03).
 * Same IPC payload drives both so web only calls setUnreadStatus once.
 *
 * Also fires a Mattermost-style backup toast when unread rises while the
 * window is in the background (covers remote UIs that skip notifyMessage).
 *
 * @param {{ getMainWindow: () => Electron.BrowserWindow | null }} deps
 */
function createUnreadStatusHandler(deps) {
  /** Skip the first unread sync after login/reload so restoring badge doesn't toast. */
  let seenInitial = false;

  return async (_event, payload) => {
    const prev = getTrayUnreadStatus();
    const normalized =
      payload != null && typeof payload === "object"
        ? /** @type {{ unread?: number | boolean, mentions?: number }} */ (payload)
        : { unread: 0, mentions: 0 };

    const status = updateTrayUnreadStatus(normalized);
    try {
      await updateAppBadge(status, { getMainWindow: deps.getMainWindow });
    } catch (err) {
      console.warn("[xinchat-desktop] app badge update failed:", err?.message || err);
    }

    const increased =
      status.unread > prev.unread || status.mentions > prev.mentions;
    if (!seenInitial) {
      seenInitial = true;
    } else if (increased) {
      // Delay so notifyMessage can claim the toast first; avoids double banners
      // that macOS then throttles/hides (esp. Script Editor / osascript path).
      setTimeout(() => {
        maybeNotifyFromUnread(status, { getMainWindow: deps.getMainWindow });
      }, 900);
    }

    return true;
  };
}

module.exports = { createUnreadStatusHandler };
