/**
 * Resolve the API origin for main-process fetches (captcha, token refresh).
 *
 * Precedence:
 *   1. QCHAT_API_URL env
 *   2. Web on :3000/:3001 (Next) → same host :8080
 *   3. Otherwise same origin as web (nginx / packaged HTTPS)
 *
 * @param {string} webUrl
 * @returns {string}
 */
function resolveApiOrigin(webUrl) {
  const fromEnv = String(process.env.QCHAT_API_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  try {
    const u = new URL(webUrl);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    if (port === "3000" || port === "3001") {
      return `${u.protocol}//${u.hostname}:8080`;
    }
    return u.origin;
  } catch {
    return String(webUrl || "").replace(/\/$/, "");
  }
}

module.exports = { resolveApiOrigin };
