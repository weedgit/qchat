const fs = require("fs");
const path = require("path");
const { session, dialog, app, Notification, shell } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { getIconPath } = require("../app/configuration/paths");

/**
 * SHELL-21 — native OS notification when a download finishes.
 * Click opens the file in the system file manager (Mattermost DownloadNotification).
 * @param {string} savePath
 */
function notifyDownloadComplete(savePath) {
  if (!Notification.isSupported()) return;
  const fileName = path.basename(savePath);
  const iconPath = getIconPath();
  const isWin = process.platform === "win32";
  const notification = new Notification({
    title: isWin ? APP_TITLE : "Download Complete",
    body: isWin ? `Download Complete\n${fileName}` : fileName,
    ...(fs.existsSync(iconPath) && process.platform !== "darwin"
      ? { icon: iconPath }
      : {}),
  });
  notification.on("click", () => {
    try {
      shell.showItemInFolder(path.normalize(savePath));
    } catch (err) {
      console.warn(
        "[xinchat-desktop] showItemInFolder failed:",
        err?.message || err
      );
    }
  });
  notification.show();
}

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

    item.once("done", (_e, state) => {
      if (state === "completed") {
        notifyDownloadComplete(result.filePath);
      }
    });
  });
}

module.exports = { registerDownloadHandler };
