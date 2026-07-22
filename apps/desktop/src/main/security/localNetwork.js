const { app } = require("electron");

/**
 * Allow LiveKit signaling/media on the LAN from Electron.
 *
 * Chromium Local/Private Network Access can block ws://192.168.x.x:7880 when the
 * shell loads the web UI from http://localhost (common with npm run start:local).
 * That surfaces as: "Couldn't reach LiveKit signaling — confirm LIVEKIT_URL…".
 *
 * Must run before app ready. Desktop-only; does not change Go or web builds.
 */
function allowLocalNetworkForCalls() {
  const disable = [
    "BlockInsecurePrivateNetworkRequests",
    "PrivateNetworkAccessSendPreflights",
    "PrivateNetworkAccessRespectPreflightResults",
    "LocalNetworkAccessChecks",
  ].join(",");

  app.commandLine.appendSwitch("disable-features", disable);
}

module.exports = { allowLocalNetworkForCalls };
