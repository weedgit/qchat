/**
 * @param {string} webUrl
 */
function createCaptchaHandler(webUrl) {
  return async () => {
    const base = String(webUrl || "").replace(/\/$/, "");
    if (!base) throw new Error("captcha: web URL not configured");

    const url = `${base}/v1/auth/captcha`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`captcha HTTP ${res.status}`);
    }
    const data = await res.json();
    return {
      captcha_id: String(data?.captcha_id ?? data?.id ?? ""),
      challenge: String(data?.challenge ?? ""),
    };
  };
}

module.exports = { createCaptchaHandler };
