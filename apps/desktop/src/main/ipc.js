const fs = require("fs");
const { ipcMain, Notification } = require("electron");
const { resolveApiUrl } = require("./config");
const { APP_TITLE, ICON_PATH, IPC } = require("./constants");
const { showAbout } = require("./menu");

function installIpcHandlers({ focusWindow, getWindow, webUrl }) {
  let pendingConversationId = "";
  const apiUrl = resolveApiUrl(webUrl);

  function openConversation(conversationId) {
    pendingConversationId = conversationId;
    getWindow().webContents.send(IPC.openConversation, conversationId);
  }

  ipcMain.handle(IPC.notify, async (_event, payload) => {
    if (!Notification.isSupported()) return false;

    const conversationId = String(payload.conversationId || "");
    const notification = new Notification({
      title: String(payload.title || APP_TITLE),
      body: String(payload.body || ""),
      silent: Boolean(payload.silent),
      ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    });
    notification.on("click", () => {
      focusWindow();
      if (conversationId) openConversation(conversationId);
    });
    notification.show();
    return true;
  });

  ipcMain.handle(IPC.fetchCaptcha, async () => {
    const response = await fetch(`${apiUrl}/v1/auth/captcha`);
    if (!response.ok) throw new Error(`captcha HTTP ${response.status}`);

    const data = await response.json();
    return {
      captcha_id: String(data.captcha_id ?? data.id ?? ""),
      challenge: String(data.challenge ?? ""),
    };
  });

  ipcMain.handle(IPC.showAbout, async () => {
    await showAbout(getWindow(), webUrl);
    return true;
  });

  ipcMain.on(IPC.rendererReady, () => {
    if (pendingConversationId) openConversation(pendingConversationId);
  });
}

module.exports = { installIpcHandlers };
