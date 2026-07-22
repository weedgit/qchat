const { shell } = require("electron");

/**
 * Restrict navigation to the configured web origin; open other http(s) in the OS browser.
 * @param {Electron.BrowserWindow} win
 * @param {string} webUrl
 */
function attachNavigationGuards(win, webUrl) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {
      /* ignore invalid urls */
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new URL(webUrl);
      if (target.origin !== allowed.origin) {
        event.preventDefault();
        if (target.protocol === "http:" || target.protocol === "https:") {
          shell.openExternal(url);
        }
      }
    } catch {
      event.preventDefault();
    }
  });
}

module.exports = { attachNavigationGuards };
