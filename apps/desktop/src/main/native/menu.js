const { Menu } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { showAbout } = require("./about");
const { isAutostartEnabled, setAutostartEnabled } = require("./autostart");

/**
 * Apply language preference in the loaded web client (localStorage qchat.locale).
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 * @param {"en"|"zh"|"system"} mode
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
 * }} opts
 */
function buildAppMenu(opts) {
  const { webUrl, isDev, getMainWindow, onAutostartChanged } = opts;
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

  if (process.platform === "darwin") {
    template.push({
      label: APP_TITLE,
      submenu: [
        { label: `About ${APP_TITLE}`, click: aboutClick },
        { type: "separator" },
        autostartItem,
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
            {
              label: "System",
              click: () => setWebLocale(getMainWindow, "system"),
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
