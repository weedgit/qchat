const APP_TITLE = "XinChat Desktop";
/** Must match package.json build.appId — required for Windows toast notifications. */
const APP_ID = "com.xinchat.desktop";
/**
 * Stable Toast Activator CLSID for Windows Action Center.
 * Must be fixed across runs and baked into the Start Menu .lnk via
 * shell.writeShortcutLink({ toastActivatorClsid }). Electron generates a
 * random CLSID per launch if unset, which makes Win11 drop toasts silently.
 */
const TOAST_ACTIVATOR_CLSID = "{B8E4D3F2-0C5E-5F9B-A032-7E9C1D5F2B3F}";
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_WINDOW = { width: 1280, height: 800 };
const DEFAULT_DEV_URL = "http://localhost:3001/xin";
const DEFAULT_PROD_URL = "https://135.181.224.36/xin";
/** Custom URL scheme for OS deep links. */
const APP_PROTOCOL = "xinchat";

module.exports = {
  APP_TITLE,
  APP_ID,
  TOAST_ACTIVATOR_CLSID,
  WINDOW_STATE_FILE,
  DEFAULT_WINDOW,
  DEFAULT_DEV_URL,
  DEFAULT_PROD_URL,
  APP_PROTOCOL,
};
