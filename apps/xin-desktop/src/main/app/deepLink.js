const { parseDeepLink } = require("./deepLinkParse");

/**
 * @param {{
 *   focusMainWindow: () => void,
 *   sendConversationToRenderer: (id: string) => void,
 * }} deps
 * @returns {(raw: string) => boolean}
 */
function createDeepLinkHandler(deps) {
  return (raw) => {
    const parsed = parseDeepLink(raw);
    if (!parsed?.conversationId) {
      console.warn("[xinchat-desktop] ignored deep link:", raw);
      return false;
    }
    deps.focusMainWindow();
    deps.sendConversationToRenderer(parsed.conversationId);
    return true;
  };
}

module.exports = { createDeepLinkHandler };
