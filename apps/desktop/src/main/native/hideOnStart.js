const { app } = require("electron");
const { readUserConfig, writeUserConfig } = require("../app/configuration/userConfig");

/**
 * Hide on start / start minimized to tray (SHELL-27).
 * Mattermost: Config.hideOnStart + --hidden / wasOpenedAsHidden.
 */

function preferredHideOnStart() {
  const value = readUserConfig().hideOnStart;
  return typeof value === "boolean" ? value : false;
}

function isHideOnStartEnabled() {
  return preferredHideOnStart();
}

/**
 * @param {boolean} enabled
 */
function setHideOnStartEnabled(enabled) {
  writeUserConfig({ hideOnStart: Boolean(enabled) });
}

/**
 * Whether this process launch should keep the main window hidden (tray only).
 * Deep links / tray Show / second-instance focus still show the window.
 *
 * @param {string[]} [argv]
 */
function shouldStartHidden(argv = process.argv) {
  if (argv.includes("--hidden") || argv.includes("--hide")) return true;
  try {
    if (process.platform === "darwin" || process.platform === "win32") {
      if (app.getLoginItemSettings?.()?.wasOpenedAsHidden) return true;
    }
  } catch {
    /* ignore */
  }
  return isHideOnStartEnabled();
}

module.exports = {
  isHideOnStartEnabled,
  setHideOnStartEnabled,
  shouldStartHidden,
};
