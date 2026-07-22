const { app } = require("electron");

/**
 * PACK-07 — production Chromium sandbox hardening.
 * Must run before app.ready (Mattermost: app.enableSandbox()).
 *
 * Packaged builds ignore QCHAT_DESKTOP_NO_SANDBOX. Dev/VM may still pass
 * --no-sandbox via launch.js when explicitly requested.
 */
function enableProductionSandbox() {
  if (app.isPackaged && process.env.QCHAT_DESKTOP_NO_SANDBOX) {
    console.warn(
      "[qchat-desktop] ignoring QCHAT_DESKTOP_NO_SANDBOX in packaged builds (PACK-07)"
    );
    delete process.env.QCHAT_DESKTOP_NO_SANDBOX;
  }

  try {
    if (typeof app.enableSandbox === "function") {
      app.enableSandbox();
    }
  } catch (err) {
    console.warn(
      "[qchat-desktop] enableSandbox failed:",
      err?.message || err
    );
  }
}

module.exports = { enableProductionSandbox };
