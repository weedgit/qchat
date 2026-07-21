const { contextBridge, ipcRenderer } = require("electron");

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
  notifyMessage: (payload) => ipcRenderer.invoke("qchat:desktop-notify", payload),
  showAbout: () => ipcRenderer.invoke("qchat:show-about"),
  fetchCaptcha: () => ipcRenderer.invoke("qchat:fetch-captcha"),
  signalReady: () => ipcRenderer.send("qchat:renderer-ready"),
  onOpenConversation: (handler) => {
    const listener = (_event, conversationId) => handler(conversationId);
    ipcRenderer.on("qchat:open-conversation", listener);
    return () => ipcRenderer.removeListener("qchat:open-conversation", listener);
  },
});
