const { session, dialog, app } = require("electron");
const path = require("path");

/**
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 */
function registerDownloadHandler(getMainWindow) {
  session.defaultSession.on("will-download", async (_event, item) => {
    const defaultPath = path.join(app.getPath("downloads"), item.getFilename());
    const result = await dialog.showSaveDialog(getMainWindow() || undefined, {
      title: "Save download",
      defaultPath,
    });
    if (result.canceled || !result.filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(result.filePath);
  });
}

module.exports = { registerDownloadHandler };
