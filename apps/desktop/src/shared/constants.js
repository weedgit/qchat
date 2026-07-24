const APP_TITLE = "Qchat Desktop";
/** Must match package.json build.appId — required for Windows toast notifications. */
const APP_ID = "com.qchat.desktop";
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_WINDOW = { width: 1280, height: 800 };
const DEFAULT_DEV_URL = "http://localhost:3000";
const DEFAULT_PROD_URL = "https://135.181.224.36";
/** Custom URL scheme for OS deep links (SHELL-28). */
const APP_PROTOCOL = "qchat";

module.exports = {
  APP_TITLE,
  APP_ID,
  WINDOW_STATE_FILE,
  DEFAULT_WINDOW,
  DEFAULT_DEV_URL,
  DEFAULT_PROD_URL,
  APP_PROTOCOL,
};
