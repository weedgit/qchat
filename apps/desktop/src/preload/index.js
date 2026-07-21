const { contextBridge, ipcRenderer } = require("electron");

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

const IPC = Object.freeze({
  fetchCaptcha: "qchat:fetch-captcha",
  notify: "qchat:desktop-notify",
  openConversation: "qchat:open-conversation",
  rendererReady: "qchat:renderer-ready",
  showAbout: "qchat:show-about",
});

contextBridge.exposeInMainWorld("qchatDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: argumentValue("qchat-version"),
  webUrl: argumentValue("qchat-web-url"),
  deviceName: `Qchat Desktop (${process.platform})`,
  notifyMessage: (payload) => ipcRenderer.invoke(IPC.notify, payload),
  showAbout: () => ipcRenderer.invoke(IPC.showAbout),
  fetchCaptcha: () => ipcRenderer.invoke(IPC.fetchCaptcha),
  signalReady: () => ipcRenderer.send(IPC.rendererReady),
  onOpenConversation: (handler) => {
    const listener = (_event, conversationId) => handler(conversationId);
    ipcRenderer.on(IPC.openConversation, listener);
    return () => ipcRenderer.removeListener(IPC.openConversation, listener);
  },
});
