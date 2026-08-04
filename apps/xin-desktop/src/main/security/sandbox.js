const { app } = require("electron");

/**
 * PACK-07 — production Chromium sandbox hardening.
 * Must run before app.ready (Mattermost: app.enableSandbox()).
 */
function enableProductionSandbox() {
  if (app.isPackaged && process.env.QCHAT_DESKTOP_NO_SANDBOX) {
    console.warn(
      "[xinchat-desktop] ignoring QCHAT_DESKTOP_NO_SANDBOX in packaged builds (PACK-07)"
    );
    delete process.env.QCHAT_DESKTOP_NO_SANDBOX;
  }

  try {
    if (typeof app.enableSandbox === "function") {
      app.enableSandbox();
    }
  } catch (err) {
    console.warn(
      "[xinchat-desktop] enableSandbox failed:",
      err?.message || err
    );
  }
}

module.exports = { enableProductionSandbox };
