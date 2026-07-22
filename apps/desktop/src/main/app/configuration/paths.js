const fs = require("fs");
const path = require("path");

/** apps/desktop package root (contains package.json, assets/, production.json). */
function getDesktopRoot() {
  // src/main/app/configuration → ../../../..
  return path.join(__dirname, "../../../..");
}

function getIconPath() {
  return path.join(getDesktopRoot(), "assets", "icon.png");
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
  getPreloadPath,
  getProductionConfigPath,
  getEnvFilePath,
  iconOption,
};
