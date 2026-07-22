const { showAbout } = require("../../native/about");

/**
 * @param {object} deps
 * @param {() => Electron.BrowserWindow | null} deps.getMainWindow
 * @param {string} deps.webUrl
 */
function createAboutHandler(deps) {
  return async () => {
    showAbout(deps.getMainWindow(), deps.webUrl);
    return true;
  };
}

module.exports = { createAboutHandler };
