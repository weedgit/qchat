const { APP_TITLE } = require("../../shared/constants");
const { getTray } = require("./tray");

/** @type {{ unread: number, mentions: number }} */
let status = { unread: 0, mentions: 0 };

function normalizeCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 9999);
}

function trayTooltip() {
  if (status.mentions > 0) {
    return `${APP_TITLE} — ${status.mentions} mention${status.mentions === 1 ? "" : "s"}`;
  }
  if (status.unread > 0) {
    return `${APP_TITLE} — ${status.unread} unread`;
  }
  return APP_TITLE;
}

/**
 * TrayIcon.update: tooltip (and macOS title) reflect unread / mention state.
 * Separate tray images deferred until assets exist; web wiring is a follow-up.
 *
 * @param {{ unread?: number, mentions?: number } | null | undefined} payload
 */
function updateTrayUnreadStatus(payload) {
  if (!payload || typeof payload !== "object") {
    status = { unread: 0, mentions: 0 };
  } else {
    status = {
      unread: normalizeCount(payload.unread),
      mentions: normalizeCount(payload.mentions),
    };
  }

  const tray = getTray();
  if (!tray || tray.isDestroyed()) return status;

  const tip = trayTooltip();
  tray.setToolTip(tip);
  // macOS menu bar / some Linux trays show a short title beside the icon.
  if (typeof tray.setTitle === "function") {
    if (status.mentions > 0) tray.setTitle(String(status.mentions));
    else if (status.unread > 0) tray.setTitle(String(status.unread));
    else tray.setTitle("");
  }

  return status;
}

function getTrayUnreadStatus() {
  return { ...status };
}

module.exports = {
  updateTrayUnreadStatus,
  getTrayUnreadStatus,
};
