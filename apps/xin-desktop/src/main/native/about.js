const { dialog } = require("electron");
const fs = require("fs");
const { APP_TITLE } = require("../../shared/constants");
const { getIconPath } = require("../app/configuration/paths");

function showAbout(mainWindow, webUrl) {
  const iconPath = getIconPath();
  const { app } = require("electron");
  const opts = {
    type: "info",
    title: `About ${APP_TITLE}`,
    message: APP_TITLE,
    detail:
      `Version: ${app.getVersion()}\n` +
      `Platform: ${process.platform}\n` +
      `Web URL: ${webUrl}\n\n` +
      "Electron shell around the XinChat web client.\n\n" +
      "Open this dialog anytime from Help → About XinChat Desktop\n" +
      "(or press Ctrl+Shift+A).",
    buttons: ["OK"],
  };
  if (fs.existsSync(iconPath)) opts.icon = iconPath;
  dialog.showMessageBox(mainWindow || undefined, opts);
}

module.exports = { showAbout };
