const { APP_PROTOCOL } = require("../../shared/constants");

/**
 * Parse qchat:// deep links into an action for the main window.
 *
 * Supported (SHELL-28 / SHELL-29):
 *   qchat://conversation/<id>
 *   qchat://chat/<id>
 *   qchat://c/<id>
 *   qchat://open?conversation=<id>
 *   qchat://open?id=<id>
 *
 * @param {string} raw
 * @returns {{ conversationId: string } | null}
 */
function parseDeepLink(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(`${APP_PROTOCOL}:`)) return null;
  // Reject path traversal before URL normalization can rewrite segments.
  if (trimmed.includes("..")) return null;

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_PROTOCOL}:`) return null;

  const host = String(u.hostname || "").toLowerCase();
  const parts = String(u.pathname || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });

  if (parts.some((p) => p === "." || p === ".." || p.includes(".."))) return null;

  let id = "";
  if (host === "conversation" || host === "chat" || host === "c") {
    if (parts.length !== 1) return null;
    id = parts[0] || "";
  } else if (!host && parts.length === 2 && ["conversation", "chat", "c"].includes(parts[0])) {
    id = parts[1] || "";
  } else if (host === "open" || (parts[0] === "open" && parts.length === 1)) {
    id = u.searchParams.get("conversation") || u.searchParams.get("id") || "";
  } else {
    return null;
  }

  id = String(id || "").trim();
  // Conversation ids are UUIDs (or similarly safe opaque tokens).
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return null;
  return { conversationId: id };
}

/**
 * Find a qchat:// URL in Electron / OS argv (Windows + Linux cold start / second-instance).
 * @param {string[]} argv
 * @returns {string | null}
 */
function getDeepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = argv.length - 1; i >= 0; i--) {
    const a = String(argv[i] || "");
    if (a.toLowerCase().startsWith(`${APP_PROTOCOL}:`)) {
      return a;
    }
  }
  return null;
}

module.exports = {
  APP_PROTOCOL,
  parseDeepLink,
  getDeepLinkFromArgv,
};
