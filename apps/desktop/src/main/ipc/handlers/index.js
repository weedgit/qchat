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

  ipcMain.on(IPC.RENDERER_READY, () => {
    deps.flushPendingConversation();
  });
}

module.exports = { registerIpcHandlers };
