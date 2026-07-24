const path = require("path");
const { app } = require("electron");
const { APP_PROTOCOL, parseDeepLink, getDeepLinkFromArgv } = require("./deepLinkParse");

/**
 * Register as the OS handler for qchat:// (Mattermost-style).
 * Safe to call before ready; no-op when registration is unsupported.
 */
function registerProtocolClient() {
  try {
    if (process.defaultApp) {
      // `electron .` / npm start: need execPath + app entry so the OS relaunches correctly.
      if (process.argv.length >= 2) {
        const appPath = path.resolve(process.argv[1]);
        app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [appPath]);
      }
      return;
    }
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  } catch (err) {
    console.warn("[qchat-desktop] protocol registration failed:", err?.message || err);
  }
}

module.exports = {
  APP_PROTOCOL,
  parseDeepLink,
  getDeepLinkFromArgv,
  registerProtocolClient,
};
