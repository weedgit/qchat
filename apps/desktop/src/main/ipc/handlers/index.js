const { ipcMain } = require("electron");
const { IPC } = require("../../../shared/ipc/channels");
const { createNotifyHandler } = require("./notify");
const { createCaptchaHandler } = require("./captcha");
const { createAboutHandler } = require("./about");
const { createUnreadStatusHandler } = require("./unreadStatus");
const { createSecureStorageHandlers } = require("./secureStorage");
const {
  createGetNativeThemeHandler,
  createSetNativeThemeSourceHandler,
} = require("./theme");
const { createGetNetworkOnlineHandler } = require("./networkStatus");
const { createGetWindowFocusedHandler } = require("./windowFocus");
const { createWriteClipboardTextHandler } = require("./clipboard");
const { createDownloadUrlHandler } = require("./download");
const {
  openCallWindow,
  focusCallWindow,
  closeCallWindow,
} = require("../../windows/callWindow");

/**
 * @param {object} deps
 * @param {string} deps.webUrl
 * @param {() => Electron.BrowserWindow | null} deps.getMainWindow
 * @param {() => void} deps.focusMainWindow
 * @param {(id: string) => void} deps.sendConversationToRenderer
 * @param {() => void} deps.flushPendingConversation
 */
function registerIpcHandlers(deps) {
  ipcMain.handle(
    IPC.DESKTOP_NOTIFY,
    createNotifyHandler({
      focusMainWindow: deps.focusMainWindow,
      sendConversationToRenderer: deps.sendConversationToRenderer,
      getMainWindow: deps.getMainWindow,
    })
  );

  ipcMain.handle(IPC.FETCH_CAPTCHA, createCaptchaHandler(deps.webUrl));

  ipcMain.handle(
    IPC.SHOW_ABOUT,
    createAboutHandler({
      getMainWindow: deps.getMainWindow,
      webUrl: deps.webUrl,
    })
  );

  ipcMain.handle(
    IPC.SET_UNREAD_STATUS,
    createUnreadStatusHandler({ getMainWindow: deps.getMainWindow })
  );

  const secure = createSecureStorageHandlers(deps.webUrl);
  ipcMain.handle(IPC.SECURE_SESSION_AVAILABLE, secure.available);
  ipcMain.handle(IPC.SECURE_SESSION_GET, secure.get);
  ipcMain.handle(IPC.SECURE_SESSION_SET, secure.set);
  ipcMain.handle(IPC.SECURE_SESSION_CLEAR, secure.clear);

  ipcMain.handle(IPC.GET_NATIVE_THEME, createGetNativeThemeHandler());
  ipcMain.handle(
    IPC.SET_NATIVE_THEME_SOURCE,
    createSetNativeThemeSourceHandler()
  );
  ipcMain.handle(IPC.GET_NETWORK_ONLINE, createGetNetworkOnlineHandler());
  ipcMain.handle(
    IPC.GET_WINDOW_FOCUSED,
    createGetWindowFocusedHandler({ getMainWindow: deps.getMainWindow })
  );
  ipcMain.handle(IPC.WRITE_CLIPBOARD_TEXT, createWriteClipboardTextHandler());
  ipcMain.handle(
    IPC.DOWNLOAD_URL,
    createDownloadUrlHandler(deps.getMainWindow)
  );

  ipcMain.handle(IPC.OPEN_CALL_WINDOW, (_event, payload) =>
    openCallWindow({
      webUrl: deps.webUrl,
      path: payload?.path || "/call",
    })
  );
  ipcMain.handle(IPC.FOCUS_CALL_WINDOW, () => ({ ok: focusCallWindow() }));
  ipcMain.handle(IPC.CLOSE_CALL_WINDOW, () => ({ ok: closeCallWindow() }));
  ipcMain.handle(IPC.FOCUS_MAIN_WINDOW, () => {
    deps.focusMainWindow();
    return { ok: true };
  });

  ipcMain.on(IPC.RENDERER_READY, () => {
    deps.flushPendingConversation();
  });
}

module.exports = { registerIpcHandlers };
