const { net } = require("electron");

/**
 * SHELL-32 — OS network online probe for the shell banner.
 * Renderer also listens to window online/offline; this is the main-process view.
 */
function createGetNetworkOnlineHandler() {
  return async () => {
    try {
      return { online: Boolean(net.isOnline()) };
    } catch {
      return { online: true };
    }
  };
}

module.exports = { createGetNetworkOnlineHandler };
