const { shell } = require("electron");

/**
 * Same Qchat server if hostnames match (HTTP↔HTTPS redirects, default ports).
 * @param {URL} a
 * @param {URL} b
 */
function isSameWebHost(a, b) {
  return a.hostname.toLowerCase() === b.hostname.toLowerCase();
}

/**
 * Restrict navigation to the configured web host; open other http(s) in the OS browser.
 * @param {Electron.BrowserWindow} win
 * @param {string} webUrl
 */
function attachNavigationGuards(win, webUrl) {
  let allowed;
  try {
    allowed = new URL(webUrl);
  } catch {
    allowed = null;
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (allowed && isSameWebHost(parsed, allowed)) {
        return { action: "allow" };
      }
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
      if (allowed && isSameWebHost(target, allowed)) {
        return;
      }
      event.preventDefault();
      if (target.protocol === "http:" || target.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });
}

module.exports = { attachNavigationGuards };
