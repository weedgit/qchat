const { enableProductionSandbox } = require("./security/sandbox");

// PACK-07: enable Chromium sandbox before any other app setup / ready work.
enableProductionSandbox();

const { app } = require("electron");
const {
  APP_TITLE,
  APP_ID,
  TOAST_ACTIVATOR_CLSID,
} = require("../shared/constants");

// Windows toast identity must be set before ready / first Notification.
// Otherwise Electron's activator writes Start Menu\Programs\Electron.lnk and
// Settings → Notifications lists the app as "Electron".
if (process.platform === "win32") {
  try {
    app.setName(APP_TITLE);
  } catch {
    /* ignore */
  }
  app.setAppUserModelId(APP_ID);
  app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
}

const { startApp } = require("./app/lifecycle");

startApp();
