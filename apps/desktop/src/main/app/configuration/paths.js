const fs = require("fs");
const path = require("path");

/** apps/desktop package root (contains package.json, assets/, production.json). */
function getDesktopRoot() {
  // src/main/app/configuration → ../../../..
  return path.join(__dirname, "../../../..");
}

/** PNG source used for tray / Linux / macOS. */
function getIconPngPath() {
  return path.join(getDesktopRoot(), "assets", "icon.png");
}

/**
 * Best icon for the current platform.
 * Windows taskbar / Start Menu / BrowserWindow require .ico — PNG shows as the
 * blank document placeholder on the Win11 taskbar when running electron.exe.
 */
function getIconPath() {
  if (process.platform === "win32") {
    const ico = path.join(getDesktopRoot(), "assets", "icon.ico");
    if (fs.existsSync(ico)) return ico;
  }
  return getIconPngPath();
}

function getPreloadPath() {
  return path.join(getDesktopRoot(), "src", "preload", "index.js");
}

function getProductionConfigPath() {
  return path.join(getDesktopRoot(), "production.json");
}

function getEnvFilePath() {
  return path.join(getDesktopRoot(), ".env");
}

function iconOption() {
  const icon = getIconPath();
  return fs.existsSync(icon) ? icon : undefined;
}

module.exports = {
  getDesktopRoot,
  getIconPath,
  getIconPngPath,
  getPreloadPath,
  getProductionConfigPath,
  getEnvFilePath,
  iconOption,
};
