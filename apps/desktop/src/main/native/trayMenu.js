const { Menu, app } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const {
  isAutostartEnabled,
  setAutostartEnabled,
  refreshAutostartLaunchFlags,
} = require("./autostart");
const {
  isHideOnStartEnabled,
  setHideOnStartEnabled,
} = require("./hideOnStart");

/**
 * Tray context menu (SHELL-25) — menus/tray.ts style: Show + Quit.
 * Includes Launch at login (SHELL-26) and Hide on start (SHELL-27).
 *
 * @param {object} deps
 * @param {() => void} deps.focusMainWindow
 * @param {() => void} [deps.onAutostartChanged]
 * @param {() => void} [deps.onHideOnStartChanged]
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
    {
      label: "Hide on start",
      type: "checkbox",
      checked: isHideOnStartEnabled(),
      click: (menuItem) => {
        setHideOnStartEnabled(menuItem.checked);
        refreshAutostartLaunchFlags();
        deps.onHideOnStartChanged?.();
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
