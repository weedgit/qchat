const fs = require("fs");
const path = require("path");
const { Tray, nativeImage, app } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { getDesktopRoot, getIconPath } = require("../app/configuration/paths");
const { buildTrayMenu } = require("./trayMenu");

/** @type {Electron.Tray | null} */
let tray = null;

function trayIconImage() {
  const root = getDesktopRoot();
  // Prefer a small asset for the notification area (Mattermost uses 16px tray icons).
  const candidates = [
    path.join(root, "assets", "icon-16.png"),
    path.join(root, "assets", "icon-32.png"),
    getIconPath(),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createEmpty();
}

/**
 * Create the system tray icon (SHELL-23) + Show/Quit menu (SHELL-25).
 * Click focuses / shows the main window.
 *
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 */
function createSystemTray(deps) {
  if (tray && !tray.isDestroyed()) return tray;

  const image = trayIconImage();
  if (image.isEmpty()) {
    console.warn("[qchat-desktop] tray icon missing; skipping system tray");
    return null;
  }

  tray = new Tray(image);
  tray.setToolTip(APP_TITLE);
  tray.setTitle?.(APP_TITLE);

  // Mattermost menus/tray.ts: context menu with show + quit.
  const menu = buildTrayMenu({ focusMainWindow: deps.focusMainWindow });
  tray.setContextMenu(menu);

  const onClick = () => {
    deps.focusMainWindow();
  };
  tray.on("click", onClick);
  // Some Linux DEs only emit double-click for restore.
  tray.on("double-click", onClick);
  tray.on("right-click", () => {
    tray?.popUpContextMenu(menu);
  });

  return tray;
}

function destroySystemTray() {
  if (!tray) return;
  try {
    if (!tray.isDestroyed()) tray.destroy();
  } catch {
    /* ignore */
  }
  tray = null;
}

function getTray() {
  return tray;
}

/** Register once: mark quit + destroy tray so icons do not linger (esp. Windows). */
function registerTrayQuitHook() {
  app.on("before-quit", () => {
    const { markAppQuitting } = require("../app/quitState");
    markAppQuitting();
    destroySystemTray();
  });
}

module.exports = {
  createSystemTray,
  destroySystemTray,
  getTray,
  registerTrayQuitHook,
};
