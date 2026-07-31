/** Shared IPC channel names (main + preload). Keep in sync with apps/web bridge usage. */
const IPC = {
  DESKTOP_NOTIFY: "qchat:desktop-notify",
  FETCH_CAPTCHA: "qchat:fetch-captcha",
  SHOW_ABOUT: "qchat:show-about",
  RENDERER_READY: "qchat:renderer-ready",
  OPEN_CONVERSATION: "qchat:open-conversation",
  SET_UNREAD_STATUS: "qchat:set-unread-status",
  SECURE_SESSION_AVAILABLE: "qchat:secure-session-available",
  SECURE_SESSION_GET: "qchat:secure-session-get",
  SECURE_SESSION_SET: "qchat:secure-session-set",
  SECURE_SESSION_CLEAR: "qchat:secure-session-clear",
  GET_NATIVE_THEME: "qchat:get-native-theme",
  SET_NATIVE_THEME_SOURCE: "qchat:set-native-theme-source",
  NATIVE_THEME_UPDATED: "qchat:native-theme-updated",
  GET_NETWORK_ONLINE: "qchat:get-network-online",
  USER_ACTIVITY_UPDATE: "qchat:user-activity-update",
  /** Mattermost-style browser focus for notification gating. */
  GET_WINDOW_FOCUSED: "qchat:get-window-focused",
  WINDOW_FOCUS_CHANGED: "qchat:window-focus-changed",
  /** Plain-text clipboard write (menu ID copy, message copy, etc.). */
  WRITE_CLIPBOARD_TEXT: "qchat:write-clipboard-text",
  OPEN_CALL_WINDOW: "qchat:open-call-window",
  FOCUS_CALL_WINDOW: "qchat:focus-call-window",
  CLOSE_CALL_WINDOW: "qchat:close-call-window",
  FOCUS_MAIN_WINDOW: "qchat:focus-main-window",
  /** Download URL → will-download Save As dialog. */
  DOWNLOAD_URL: "qchat:download-url",
};

module.exports = { IPC };
