function allowLocalNetworkForCalls() {
  const { app } = require("electron");
  if (!app?.commandLine?.appendSwitch) {
    console.warn(
      "[qchat-desktop] electron app unavailable (is ELECTRON_RUN_AS_NODE set?); skipping LAN network switches"
    );
    return;
  }
  const disable = [
    "BlockInsecurePrivateNetworkRequests",
    "PrivateNetworkAccessSendPreflights",
    "PrivateNetworkAccessRespectPreflightResults",
    "LocalNetworkAccessChecks",
  ].join(",");

  app.commandLine.appendSwitch("disable-features", disable);
}

module.exports = { allowLocalNetworkForCalls };
