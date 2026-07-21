const fs = require("fs");
const { app, BrowserWindow } = require("electron");
const { isDevelopment, resolveStartUrl, resolveWebUrl } = require("./config");
const { APP_TITLE, ICON_PATH } = require("./constants");
const { installIpcHandlers } = require("./ipc");
const { installApplicationMenu } = require("./menu");
const { installSessionHandlers } = require("./session");
const { createMainWindow } = require("./window");

const webUrl = resolveWebUrl();
const startUrl = resolveStartUrl(webUrl);
const isDev = isDevelopment();
let mainWindow;

function createWindow() {
  mainWindow = createMainWindow({ isDev, startUrl, webUrl });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function focusWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", focusWindow);

  app.whenReady().then(() => {
    app.setName(APP_TITLE);
    if (process.platform === "linux" && fs.existsSync(ICON_PATH)) {
      app.dock?.setIcon?.(ICON_PATH);
    }

    const getWindow = () => mainWindow;
    installSessionHandlers(webUrl, getWindow);
    installIpcHandlers({ focusWindow, getWindow, webUrl });
    installApplicationMenu({ getWindow, isDev, webUrl });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
