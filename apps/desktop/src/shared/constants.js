const APP_TITLE = "Qchat Desktop";
/** Must match package.json build.appId — required for Windows toast notifications. */
const APP_ID = "com.qchat.desktop";
/**
 * Stable Toast Activator CLSID for Windows Action Center.
 * Must be fixed across runs and baked into the Start Menu .lnk via
 * shell.writeShortcutLink({ toastActivatorClsid }). Electron generates a
 * random CLSID per launch if unset, which makes Win11 drop toasts silently.
 */
const TOAST_ACTIVATOR_CLSID = "{A7F3C2E1-9B4D-4E8A-9F21-6D8B0C4E1A2F}";
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_WINDOW = { width: 1280, height: 800 };
const DEFAULT_DEV_URL = "http://localhost:3000";
const DEFAULT_PROD_URL = "https://135.181.224.36";
/** Custom URL scheme for OS deep links (SHELL-28). */
const APP_PROTOCOL = "qchat";

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
