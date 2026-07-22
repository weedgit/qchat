const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const { APP_TITLE } = require("../../shared/constants");
const { getIconPath } = require("../app/configuration/paths");
const { resolveWebUrl } = require("../app/configuration/webUrl");
const { buildAppMenu } = require("../native/menu");
const { registerPermissionHandler } = require("../security/permissions");
const { registerDownloadHandler } = require("../services/downloads");
const { registerIpcHandlers } = require("../ipc/handlers");
const {
  getMainWindow,
  focusMainWindow,
  createMainWindow,
  sendConversationToRenderer,
  flushPendingConversation,
} = require("../windows/mainWindow");

function startApp() {
  const webUrl = resolveWebUrl();
  const isDev =
    process.env.QCHAT_DESKTOP_DEV === "1" || process.argv.includes("--dev");
  const iconPath = getIconPath();

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    focusMainWindow(() => createMainWindow({ webUrl, isDev }));
  });

  app.whenReady().then(() => {
    app.setName(APP_TITLE);
    if (process.platform === "linux" && fs.existsSync(iconPath)) {
      app.dock?.setIcon?.(iconPath);
    }

    registerPermissionHandler();
    registerDownloadHandler(getMainWindow);

    registerIpcHandlers({
      webUrl,
      getMainWindow,
      focusMainWindow: () => focusMainWindow(() => createMainWindow({ webUrl, isDev })),
      sendConversationToRenderer,
      flushPendingConversation,
    });

    process.env.QCHAT_WEB_URL_RESOLVED = webUrl;
    buildAppMenu({
      webUrl,
      isDev,
      getMainWindow,
    });
    createMainWindow({ webUrl, isDev });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({ webUrl, isDev });
      } else {
        focusMainWindow(() => createMainWindow({ webUrl, isDev }));
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

module.exports = { startApp };
