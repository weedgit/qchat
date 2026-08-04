const { app } = require("electron");

/** @type {number | null} */
let bounceId = null;
/** @type {WeakSet<Electron.BrowserWindow>} */
const focusBound = new WeakSet();

/**
 * Stop taskbar flash / cancel dock bounce (NOTI-05).
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 */
function clearWindowAttention(getMainWindow) {
  const win = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (win && !win.isDestroyed()) {
    try {
      win.flashFrame(false);
    } catch {
      /* ignore */
    }
  }
  if (bounceId != null && typeof app.dock?.cancelBounce === "function") {
    try {
      app.dock.cancelBounce(bounceId);
    } catch {
      /* ignore */
    }
    bounceId = null;
  }
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 */
function bindClearOnFocus(win, getMainWindow) {
  if (!win || win.isDestroyed() || focusBound.has(win)) return;
  focusBound.add(win);
  win.on("focus", () => clearWindowAttention(getMainWindow));
  win.on("show", () => {
    if (win.isFocused()) clearWindowAttention(getMainWindow);
  });
}

/**
 * NOTI-05 — flash taskbar (Win/Linux) or bounce Dock (macOS) for mentions
 * when the main window is not focused.
 *
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 * @param {{ mention?: boolean }} [opts]
 */
function requestWindowAttention(getMainWindow, opts = {}) {
  if (!opts.mention) return;

  const win = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (!win || win.isDestroyed()) return;

  bindClearOnFocus(win, getMainWindow);

  if (win.isFocused() && win.isVisible()) return;

  if (process.platform === "darwin") {
    try {
      if (typeof app.dock?.bounce === "function") {
        bounceId = app.dock.bounce("informational");
      }
    } catch (err) {
      console.warn(
        "[xinchat-desktop] dock bounce failed:",
        err?.message || err
      );
    }
    return;
  }

  try {
    win.flashFrame(true);
  } catch (err) {
    console.warn(
      "[xinchat-desktop] flashFrame failed:",
      err?.message || err
    );
  }
}

module.exports = {
  requestWindowAttention,
  clearWindowAttention,
};
