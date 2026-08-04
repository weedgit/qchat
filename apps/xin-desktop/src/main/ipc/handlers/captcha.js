const { net } = require("electron");
const { resolveApiOrigin } = require("../../app/configuration/apiUrl");

/**
 * @param {string} webUrl
 */
function createCaptchaHandler(webUrl) {
  return async () => {
    const base = resolveApiOrigin(webUrl);
    if (!base) throw new Error("captcha: API URL not configured");

    // Use Chromium net stack so certificate-error trust for the web host applies.
    const url = `${base}/v1/auth/captcha`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await net.fetch(url, { method: "GET", signal: ac.signal });
      if (!res.ok) {
        throw new Error(`captcha HTTP ${res.status}`);
      }
      const data = await res.json();
      return {
        captcha_id: String(data?.captcha_id ?? data?.id ?? ""),
        image: String(data?.image ?? ""),
        // Pass through for local auto-fill when present.
        ...(data?.dev_answer ? { dev_answer: String(data.dev_answer) } : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createCaptchaHandler };
