const { session } = require("electron");

function registerPermissionHandler() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["notifications", "media", "mediaKeySystem"].includes(permission));
  });
}

module.exports = { registerPermissionHandler };
