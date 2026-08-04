/**
 * Mattermost-style window focus probe for notification gating.
 * @param {{ getMainWindow: () => Electron.BrowserWindow | null }} deps
 */
function createGetWindowFocusedHandler(deps) {
  return async () => {
    const win =
      typeof deps.getMainWindow === "function" ? deps.getMainWindow() : null;
    if (!win || win.isDestroyed()) {
      return { focused: false };
    }
    const focused =
      win.isVisible() && !win.isMinimized() && win.isFocused();
    return { focused };
  };
}

/**
 * Push focus/blur to the renderer (Mattermost browser.focused equivalent).
 * @param {Electron.BrowserWindow} win
 * @param {(channel: string, payload: { focused: boolean }) => void} send
 * @param {string} channel
 */
function attachWindowFocusBridge(win, send, channel) {
  if (!win || win.isDestroyed()) return () => {};

  const emit = () => {
    if (win.isDestroyed()) return;
    const focused =
      win.isVisible() && !win.isMinimized() && win.isFocused();
    try {
      send(channel, { focused });
    } catch {
      /* ignore */
    }
  };

  win.on("focus", emit);
  win.on("blur", emit);
  win.on("show", emit);
  win.on("hide", emit);
  win.on("minimize", emit);
  win.on("restore", emit);

  // Initial state after load.
  setTimeout(emit, 0);

  return () => {
    try {
      win.removeListener("focus", emit);
      win.removeListener("blur", emit);
      win.removeListener("show", emit);
      win.removeListener("hide", emit);
      win.removeListener("minimize", emit);
      win.removeListener("restore", emit);
    } catch {
      /* ignore */
    }
  };
}

module.exports = {
  createGetWindowFocusedHandler,
  attachWindowFocusBridge,
};
