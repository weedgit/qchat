/**
 * Pure helpers for SHELL-22 (no Electron import — safe for node check scripts).
 */

/**
 * @param {object} params
 * @returns {boolean}
 */
function shouldShowMenu(params) {
  if (!params || typeof params !== "object") return false;
  const linkURL = String(params.linkURL || "");
  const pageURL = String(params.pageURL || "");
  const isInternalLink =
    linkURL.endsWith("#") && linkURL.slice(0, -1) === pageURL;
  const mediaType = params.mediaType || "none";
  return (
    Boolean(params.isEditable) ||
    (mediaType !== "none" && Boolean(params.srcURL)) ||
    (linkURL !== "" && !isInternalLink) ||
    Boolean(params.misspelledWord) ||
    Boolean(String(params.selectionText || "").trim())
  );
}

/**
 * @param {string} linkURL
 * @returns {string | null}
 */
function emailFromMailto(linkURL) {
  const raw = String(linkURL || "");
  if (!/^mailto:/i.test(raw)) return null;
  try {
    const u = new URL(raw);
    const addr = decodeURIComponent(
      (u.pathname || "").replace(/^\/+/, "") ||
        raw.slice(raw.indexOf(":") + 1).split("?")[0]
    ).trim();
    return addr || null;
  } catch {
    const rest = raw.slice(raw.indexOf(":") + 1).split("?")[0];
    try {
      return decodeURIComponent(rest).trim() || null;
    } catch {
      return rest.trim() || null;
    }
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {Array<{ type?: string }>} template
 * @returns {Array<{ type?: string }>}
 */
function cleanTemplate(template) {
  const cleaned = [];
  for (const item of template) {
    if (item.type === "separator") {
      if (!cleaned.length || cleaned[cleaned.length - 1].type === "separator") {
        continue;
      }
    }
    cleaned.push(item);
  }
  while (cleaned.length && cleaned[cleaned.length - 1].type === "separator") {
    cleaned.pop();
  }
  return cleaned;
}

module.exports = {
  shouldShowMenu,
  emailFromMailto,
  isHttpUrl,
  cleanTemplate,
};
