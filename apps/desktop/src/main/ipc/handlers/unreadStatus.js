const { updateTrayUnreadStatus } = require("../../native/trayStatus");

/**
 * @param {unknown} payload
 */
function createUnreadStatusHandler() {
  return async (_event, payload) => {
    if (payload != null && typeof payload !== "object") {
      return updateTrayUnreadStatus({ unread: 0, mentions: 0 });
    }
    return updateTrayUnreadStatus(
      /** @type {{ unread?: number, mentions?: number } | null} */ (payload)
    );
  };
}

module.exports = { createUnreadStatusHandler };
