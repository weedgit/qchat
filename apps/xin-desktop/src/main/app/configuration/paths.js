const fs = require("fs");
const path = require("path");
const { nativeImage } = require("electron");

/** apps/desktop package root (contains package.json, assets/, production.json). */
function getDesktopRoot() {
  // src/main/app/configuration → ../../../..
  return path.join(__dirname, "../../../..");
}

/** PNG source used for tray / notifications / window chrome. */
function getIconPngPath() {
  return path.join(getDesktopRoot(), "assets", "icon.png");
}

/**
 * Runtime icon path for Electron APIs.
 * Prefer PNG — Electron nativeImage loads it reliably. A hand-rolled .ico can
 * fail (`Failed to load image`) and blank the Win11 taskbar.
 * electron-builder still uses assets/icon.ico for NSIS when present.
 */
function getIconPath() {
  const png = getIconPngPath();
  if (fs.existsSync(png)) return png;
  const ico = path.join(getDesktopRoot(), "assets", "icon.ico");
  if (fs.existsSync(ico)) return ico;
  return png;
}

/** @returns {Electron.NativeImage | undefined} */
function loadAppNativeImage() {
  const candidates = [
    path.join(getDesktopRoot(), "assets", "icon-256.png"),
    path.join(getDesktopRoot(), "assets", "icon-128.png"),
    getIconPngPath(),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return undefined;
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
  return loadAppNativeImage();
}

module.exports = {
  getDesktopRoot,
  getIconPath,
  getIconPngPath,
  loadAppNativeImage,
  getPreloadPath,
  getProductionConfigPath,
  getEnvFilePath,
  iconOption,
};
