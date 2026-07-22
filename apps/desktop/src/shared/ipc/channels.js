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
};

module.exports = { IPC };
