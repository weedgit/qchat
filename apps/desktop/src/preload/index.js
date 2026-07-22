const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
const { IPC } = require("../shared/ipc/channels");

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

const pkg = (() => {
  try {
    return require(path.join(__dirname, "../../package.json"));
  } catch {
    return { version: "0.1.0" };
  }
})();

/**
 * Narrow desktop bridge for the remote web renderer (apps/web).
 * Keep the `qchatDesktop` name — web code depends on it.
 * Prefer additionalArguments (sandbox-safe) over process.env.
 */
contextBridge.exposeInMainWorld("qchatDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: argumentValue("qchat-version") || String(pkg.version || "0.1.0"),
  webUrl:
    argumentValue("qchat-web-url") ||
    process.env.QCHAT_WEB_URL_RESOLVED ||
    process.env.QCHAT_WEB_URL ||
    "",
  deviceName: `Qchat Desktop (${process.platform})`,
  notifyMessage: (payload) => ipcRenderer.invoke(IPC.DESKTOP_NOTIFY, payload),
  showAbout: () => ipcRenderer.invoke(IPC.SHOW_ABOUT),
  fetchCaptcha: () => ipcRenderer.invoke(IPC.FETCH_CAPTCHA),
  signalReady: () => ipcRenderer.send(IPC.RENDERER_READY),
  onOpenConversation: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, conversationId) => handler(conversationId);
    ipcRenderer.on(IPC.OPEN_CONVERSATION, listener);
    return () => ipcRenderer.removeListener(IPC.OPEN_CONVERSATION, listener);
  },
});
