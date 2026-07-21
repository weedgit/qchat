const path = require("path");

const APP_ROOT = path.resolve(__dirname, "../..");
const APP_TITLE = "Qchat Desktop";
const DEFAULT_WINDOW = { width: 1280, height: 800 };
const ICON_PATH = path.join(APP_ROOT, "assets", "icon.png");
const IPC = Object.freeze({
  fetchCaptcha: "qchat:fetch-captcha",
  notify: "qchat:desktop-notify",
  openConversation: "qchat:open-conversation",
  rendererReady: "qchat:renderer-ready",
  showAbout: "qchat:show-about",
});

module.exports = {
  APP_ROOT,
  APP_TITLE,
  DEFAULT_WINDOW,
  ICON_PATH,
  IPC,
};
