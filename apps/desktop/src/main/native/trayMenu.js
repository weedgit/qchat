const { Menu, app } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { isAutostartEnabled, setAutostartEnabled } = require("./autostart");

/**
 * Tray context menu (SHELL-25) — menus/tray.ts style: Show + Quit.
 * Includes Launch at login checkbox (SHELL-26).
 *
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 * @param {() => void} [deps.onAutostartChanged]
 * @returns {Electron.Menu}
 */
function buildTrayMenu(deps) {
  return Menu.buildFromTemplate([
    {
      label: `Show ${APP_TITLE}`,
      click: () => deps.focusMainWindow(),
    },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: isAutostartEnabled(),
      click: (menuItem) => {
        setAutostartEnabled(menuItem.checked);
        deps.onAutostartChanged?.();
      },
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
