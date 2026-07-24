const { contextBridge, ipcRenderer } = require("electron");
const os = require("os");
const { IPC } = require("../shared/ipc/channels");

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

/** Friendly OS label for session settings (Windows 11, Ubuntu 24.04, …). */
function platformLabel() {
  const plat = process.platform;
  const release = os.release();
  if (plat === "win32") {
    const build = parseInt(String(release).split(".")[2] || "0", 10);
    if (build >= 22000) return "Windows 11";
    if (String(release).startsWith("10.")) return "Windows 10";
    return `Windows (${release})`;
  }
  if (plat === "darwin") {
    const ver = typeof os.version === "function" ? os.version() : "";
    if (ver && /macOS|Mac/i.test(ver)) return ver.replace(/^Darwin[^0-9]*/i, "macOS ").trim();
    return `macOS (${release})`;
  }
  if (plat === "linux") {
    const ver = typeof os.version === "function" ? String(os.version() || "") : "";
    if (/ubuntu/i.test(ver)) {
      const m = ver.match(/ubuntu[^0-9]*([\d.]+)/i);
      return m ? `Ubuntu ${m[1]}` : ver;
    }
    if (ver && ver !== "Linux") return ver;
    return `Linux (${release})`;
  }
  return `${plat} (${release})`;
}

const osLabel = platformLabel();

contextBridge.exposeInMainWorld("qchatDesktop", {
  isDesktop: true,
  platform: process.platform,
  platformLabel: osLabel,
  version: argumentValue("qchat-version"),
  webUrl: argumentValue("qchat-web-url"),
  deviceName: `Qchat Desktop (${osLabel})`,
  notifyMessage: (payload) => ipcRenderer.invoke(IPC.DESKTOP_NOTIFY, payload),
  showAbout: () => ipcRenderer.invoke(IPC.SHOW_ABOUT),
  fetchCaptcha: () => ipcRenderer.invoke(IPC.FETCH_CAPTCHA),
  setUnreadStatus: (payload) => ipcRenderer.invoke(IPC.SET_UNREAD_STATUS, payload),
  signalReady: () => ipcRenderer.send(IPC.RENDERER_READY),
  onOpenConversation: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, conversationId) => handler(conversationId);
    ipcRenderer.on(IPC.OPEN_CONVERSATION, listener);
    return () => ipcRenderer.removeListener(IPC.OPEN_CONVERSATION, listener);
  },
  /** OS-backed encrypted session tokens (AUTH-03). */
  secureSessionAvailable: () => ipcRenderer.invoke(IPC.SECURE_SESSION_AVAILABLE),
  getSecureSession: () => ipcRenderer.invoke(IPC.SECURE_SESSION_GET),
  setSecureSession: (tokens) => ipcRenderer.invoke(IPC.SECURE_SESSION_SET, tokens),
  clearSecureSession: () => ipcRenderer.invoke(IPC.SECURE_SESSION_CLEAR),
  /** SHELL-31: OS / shell chrome theme. */
  getNativeTheme: () => ipcRenderer.invoke(IPC.GET_NATIVE_THEME),
  setNativeThemeSource: (source) =>
    ipcRenderer.invoke(IPC.SET_NATIVE_THEME_SOURCE, source),
  onNativeThemeUpdated: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC.NATIVE_THEME_UPDATED, listener);
    return () => ipcRenderer.removeListener(IPC.NATIVE_THEME_UPDATED, listener);
  },
  /** SHELL-32: main-process network probe (complements window online/offline). */
  getNetworkOnline: () => ipcRenderer.invoke(IPC.GET_NETWORK_ONLINE),
  /** AUTH-04: system idle / lock → activity bridge. */
  onUserActivity: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC.USER_ACTIVITY_UPDATE, listener);
    return () =>
      ipcRenderer.removeListener(IPC.USER_ACTIVITY_UPDATE, listener);
  },
});
