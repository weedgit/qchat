const { Menu } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { showAbout } = require("./about");
const { getAutoUpdateApi } = require("../services/autoUpdate");
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
 * @param {{
 *   webUrl: string,
 *   isDev: boolean,
 *   getMainWindow: () => Electron.BrowserWindow | null,
 *   onAutostartChanged?: () => void,
 *   onHideOnStartChanged?: () => void,
 * }} opts
 */
function buildAppMenu(opts) {
  const {
    webUrl,
    isDev,
    getMainWindow,
    onAutostartChanged,
    onHideOnStartChanged,
  } = opts;
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  const aboutClick = () => showAbout(getMainWindow(), webUrl);
  const autostartItem = {
    label: "Launch at login",
    type: "checkbox",
    checked: isAutostartEnabled(),
    click: (menuItem) => {
      setAutostartEnabled(menuItem.checked);
      onAutostartChanged?.();
      buildAppMenu(opts);
    },
  };
  const hideOnStartItem = {
    label: "Hide on start",
    type: "checkbox",
    checked: isHideOnStartEnabled(),
    click: (menuItem) => {
      setHideOnStartEnabled(menuItem.checked);
      refreshAutostartLaunchFlags();
      onHideOnStartChanged?.();
      onAutostartChanged?.();
      buildAppMenu(opts);
    },
  };

  if (process.platform === "darwin") {
    template.push({
      label: APP_TITLE,
      submenu: [
        { label: `About ${APP_TITLE}`, click: aboutClick },
        { type: "separator" },
        autostartItem,
        hideOnStartItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [
        autostartItem,
        hideOnStartItem,
        { type: "separator" },
        { role: "quit", label: "Quit Qchat" },
      ],
    });
  }

  template.push(
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => {
            getAutoUpdateApi()
              .checkForUpdates({ manual: true })
              .catch(() => {});
          },
        },
        { type: "separator" },
        {
          label: `About ${APP_TITLE}`,
          accelerator: "CmdOrCtrl+Shift+A",
          click: aboutClick,
        },
      ],
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildAppMenu };
