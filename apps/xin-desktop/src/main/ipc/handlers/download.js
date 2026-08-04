/**
 * Trigger Electron will-download → native Save As dialog.
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 */
function createDownloadUrlHandler(getMainWindow) {
  return async (_event, payload) => {
    const url = String(payload?.url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: "invalid_url" };
    }
    const win = getMainWindow?.() || null;
    const wc = win && !win.isDestroyed() ? win.webContents : null;
    if (!wc || wc.isDestroyed()) {
      return { ok: false, error: "no_window" };
    }
    try {
      wc.downloadURL(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || "download_failed" };
    }
  };
}

module.exports = { createDownloadUrlHandler };
