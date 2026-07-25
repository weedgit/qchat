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
    const res = await net.fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`captcha HTTP ${res.status}`);
    }
    const data = await res.json();
    return {
      captcha_id: String(data?.captcha_id ?? data?.id ?? ""),
      image: String(data?.image ?? ""),
    };
  };
}

module.exports = { createCaptchaHandler };
