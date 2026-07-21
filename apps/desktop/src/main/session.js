const path = require("path");
const { app, dialog, session } = require("electron");

const ALLOWED_PERMISSIONS = new Set(["media", "mediaKeySystem", "notifications"]);

function isAllowedOrigin(url, allowedOrigin) {
  try {
    return new URL(url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

function installSessionHandlers(webUrl, getWindow) {
  const allowedOrigin = new URL(webUrl).origin;

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      ALLOWED_PERMISSIONS.has(permission) &&
      isAllowedOrigin(requestingOrigin || webContents.getURL(), allowedOrigin),
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || webContents.getURL();
      callback(
        ALLOWED_PERMISSIONS.has(permission) &&
          isAllowedOrigin(requestingUrl, allowedOrigin),
      );
    },
  );

  session.defaultSession.on("will-download", async (_event, item) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: "Save download",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
    if (result.canceled || !result.filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(result.filePath);
  });
}

module.exports = { installSessionHandlers };
