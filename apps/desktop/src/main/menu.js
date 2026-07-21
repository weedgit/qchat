const { app, dialog, Menu } = require("electron");
const { APP_TITLE } = require("./constants");

function showAbout(window, webUrl) {
  return dialog.showMessageBox(window, {
    type: "info",
    title: `About ${APP_TITLE}`,
    message: APP_TITLE,
    detail:
      `Version: ${app.getVersion()}\n` +
      `Platform: ${process.platform}\n` +
      `Web URL: ${webUrl}\n\n` +
      "Electron shell around the Qchat web client.",
    buttons: ["OK"],
  });
}

function installApplicationMenu({ getWindow, isDev, webUrl }) {
  const about = () => showAbout(getWindow(), webUrl);
  const template = [];

  if (process.platform === "darwin") {
    template.push({
      label: APP_TITLE,
      submenu: [
        { label: `About ${APP_TITLE}`, click: about },
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
      submenu: [{ role: "quit", label: "Quit Qchat" }],
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
          label: `About ${APP_TITLE}`,
          accelerator: "CmdOrCtrl+Shift+A",
          click: about,
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installApplicationMenu, showAbout };
