/** Shared IPC channel names (main + preload). Keep in sync with apps/web bridge usage. */
const IPC = {
  DESKTOP_NOTIFY: "qchat:desktop-notify",
  FETCH_CAPTCHA: "qchat:fetch-captcha",
  SHOW_ABOUT: "qchat:show-about",
  RENDERER_READY: "qchat:renderer-ready",
  OPEN_CONVERSATION: "qchat:open-conversation",
  SET_UNREAD_STATUS: "qchat:set-unread-status",
};

module.exports = { IPC };
