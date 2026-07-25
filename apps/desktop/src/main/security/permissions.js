const { session } = require("electron");

/** Permissions needed for chat notifications, LiveKit mic/camera, and LAN access prompts. */
const ALLOWED_PERMISSIONS = new Set([
  "notifications",
  "media",
  "mediaKeySystem",
  // Screen / window capture (getDisplayMedia) — CALL-02.
  "display-capture",
  // Clipboard API (navigator.clipboard.writeText / read).
  "clipboard-read",
  "clipboard-sanitized-write",
  "clipboard-write",
  // Chromium Local Network Access (wording varies by Electron/Chromium version).
  "local-network",
  "local-network-access",
  "localNetwork",
  "localNetworkAccess",
]);

function registerPermissionHandler() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(String(permission)));
  });

  // Newer Chromium may use check handler for local-network without a user prompt path.
  if (typeof session.defaultSession.setPermissionCheckHandler === "function") {
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return ALLOWED_PERMISSIONS.has(String(permission));
    });
  }
}

module.exports = { registerPermissionHandler };
