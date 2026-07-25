const { net } = require("electron");
const {
  getSecureSession,
  setSecureSession,
  clearSecureSession,
} = require("../secureStorage");
const { resolveApiOrigin } = require("../app/configuration/apiUrl");

function accessExpired(token, skewMs = 60_000) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return true;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp);
    if (!exp) return true;
    return exp * 1000 <= Date.now() + skewMs;
  } catch {
    return true;
  }
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Ensure vault tokens still work against the API (refresh when needed).
 * Returns a fresh session, or null if the user must sign in again.
 * @param {string} webUrl
 */
async function ensureVaultSessionFresh(webUrl) {
  const current = getSecureSession(webUrl);
  if (!current?.accessToken) return null;

  const origin = resolveApiOrigin(webUrl);
  if (!origin) return null;

  const tryMe = async (accessToken) => {
    const res = await net.fetch(`${origin}/v1/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  };

  try {
    if (!accessExpired(current.accessToken) && (await tryMe(current.accessToken))) {
      return current;
    }
  } catch (err) {
    console.warn("[qchat-desktop] /v1/me probe failed:", err?.message || err);
  }

  const refreshToken = String(current.refreshToken || "").trim();
  if (!refreshToken) {
    console.warn("[qchat-desktop] session expired and no refresh token in vault");
    clearSecureSession(webUrl);
    return null;
  }

  try {
    const res = await net.fetch(`${origin}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      console.warn("[qchat-desktop] refresh failed:", res.status);
      clearSecureSession(webUrl);
      return null;
    }
    const accessToken = String(
      body?.access_token ?? body?.data?.access_token ?? ""
    ).trim();
    const nextRefresh = String(
      body?.refresh_token ?? body?.data?.refresh_token ?? refreshToken
    ).trim();
    if (!accessToken) {
      clearSecureSession(webUrl);
      return null;
    }
    const next = { accessToken, refreshToken: nextRefresh };
    setSecureSession(webUrl, next);
    return next;
  } catch (err) {
    console.warn("[qchat-desktop] refresh request failed:", err?.message || err);
    // Keep vault on transient network errors — caller may retry or show UI.
    return current;
  }
}

module.exports = { ensureVaultSessionFresh, accessExpired };
