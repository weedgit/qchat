const { Menu, app } = require("electron");
const { APP_TITLE } = require("../../shared/constants");

/**
 * Tray context menu (SHELL-25) — Mattermost menus/tray.ts style: Show + Quit.
 *
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 * @returns {Electron.Menu}
 */
function buildTrayMenu(deps) {
  return Menu.buildFromTemplate([
    {
      label: `Show ${APP_TITLE}`,
      click: () => deps.focusMainWindow(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
}

module.exports = { buildTrayMenu };
