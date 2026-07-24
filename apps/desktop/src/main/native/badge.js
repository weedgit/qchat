const { app, nativeImage } = require("electron");
const { APP_TITLE } = require("../../shared/constants");

const MAX_BADGE = 99;

function normalizeCount(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 9999);
}

function badgeLabel(unread, mentions) {
  if (mentions > 0) {
    return mentions > MAX_BADGE ? `${MAX_BADGE}+` : String(mentions);
  }
  if (unread > 0) {
    // Mattermost: unread without mentions shows a dot on dock/taskbar.
    return "•";
  }
  return "";
}

function badgeDescription(unread, mentions) {
  if (mentions > 0) {
    return `You have ${mentions} unread mention${mentions === 1 ? "" : "s"}`;
  }
  if (unread > 0) {
    return `You have ${unread} unread message${unread === 1 ? "" : "s"}`;
  }
  return `${APP_TITLE}: no unread messages`;
}

/**
 * Windows taskbar overlay — draw a red circle via the window's page canvas
 * (Mattermost badge.ts approach; main process has no DOM canvas).
 * @param {Electron.BrowserWindow | null} win
 * @param {string} text
 * @param {string} description
 */
async function setWindowsOverlay(win, text, description) {
  if (!win || win.isDestroyed()) return;
  if (!text) {
    win.setOverlayIcon(null, description);
    return;
  }
  try {
    const dataUrl = await win.webContents.executeJavaScript(
      `(() => {
        const text = ${JSON.stringify(text)};
        const scale = 2;
        const size = 16 * scale;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#FF1744";
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const fontPx = text.length > 2 ? 9 : 11;
        ctx.font = fontPx * scale + "px sans-serif";
        ctx.fillText(text, size / 2, size / 2 + scale, size);
        return canvas.toDataURL();
      })();`,
      true
    );
    if (!dataUrl) {
      win.setOverlayIcon(null, description);
      return;
    }
    win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), description);
  } catch (err) {
    console.warn("[qchat-desktop] taskbar overlay badge failed:", err?.message || err);
  }
}

/**
 * Dock (macOS) / taskbar (Windows) / Unity (Linux) unread badge.
 * Mattermost-inspired; call whenever tray unread totals change.
 *
 * @param {{ unread?: number | boolean, mentions?: number } | null | undefined} payload
 * @param {{ getMainWindow?: () => Electron.BrowserWindow | null }} [opts]
 */
async function updateAppBadge(payload, opts = {}) {
  const unread = normalizeCount(payload?.unread);
  const mentions = normalizeCount(payload?.mentions);
  const label = badgeLabel(unread, mentions);
  const description = badgeDescription(unread, mentions);

  if (process.platform === "darwin") {
    app.dock?.setBadge?.(label === "•" ? "•" : label);
    return { unread, mentions, label };
  }

  if (process.platform === "win32") {
    const win = typeof opts.getMainWindow === "function" ? opts.getMainWindow() : null;
    // Numeric mentions preferred; unread-only uses a dot like Mattermost.
    await setWindowsOverlay(win, label, description);
    return { unread, mentions, label };
  }

  if (process.platform === "linux") {
    // Unity launcher count; fall back to unread total when there are no mentions.
    const count = mentions > 0 ? mentions : unread;
    try {
      if (typeof app.isUnityRunning === "function" && !app.isUnityRunning()) {
        // Still set count — some DEs honor it without Unity.
      }
      app.setBadgeCount(count);
    } catch (err) {
      console.warn("[qchat-desktop] setBadgeCount failed:", err?.message || err);
    }
    return { unread, mentions, label, count };
  }

  return { unread, mentions, label };
}

module.exports = {
  updateAppBadge,
  badgeLabel,
  normalizeCount,
};
