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
 * Apply language preference in the loaded web client (localStorage qchat.locale).
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 * @param {"en"|"zh"} mode
 */
function setWebLocale(getMainWindow, mode) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const js = `(function(){try{localStorage.setItem('qchat.locale',${JSON.stringify(
    mode
  )});window.dispatchEvent(new Event('qchat-locale-change'));}catch(e){}})();`;
  win.webContents.executeJavaScript(js).catch(() => {});
}

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
  // Windows / Linux: remove the menubar entirely (not auto-hide).
  // Tray still exposes Show / Launch at login / Hide on start / Quit.
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  const {
    webUrl,
    isDev,
    getMainWindow,
    onAutostartChanged,
    onHideOnStartChanged,
  } = opts;

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

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
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
    },
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
        { type: "separator" },
        {
          label: "Language",
          submenu: [
            {
              label: "English",
              click: () => setWebLocale(getMainWindow, "en"),
            },
            {
              label: "简体中文",
              click: () => setWebLocale(getMainWindow, "zh"),
            },
          ],
        },
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
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildAppMenu };
