const { contextBridge } = require("electron");

const pkg = (() => {
  try {
    return require("./package.json");
  } catch {
    return { version: "0.1.0" };
  }
})();

contextBridge.exposeInMainWorld("qchatDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: String(pkg.version || "0.1.0"),
  webUrl: process.env.QCHAT_WEB_URL_RESOLVED || process.env.QCHAT_WEB_URL || "",
  deviceName: `Qchat Desktop (${process.platform})`,
});
