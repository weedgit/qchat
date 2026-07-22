const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

const SECURE_DIR = "secure";
const ENCRYPTED_FILE = "session.encrypted";
const PLAINTEXT_FILE = "session.plaintext.json";

/**
 * token vault: encrypt with Electron safeStorage when the OS
 * keychain/DPAPI is available; otherwise fall back to mode-0600 plaintext JSON.
 */

function storageDir() {
  return path.join(app.getPath("userData"), SECURE_DIR);
}

function encryptedPath() {
  return path.join(storageDir(), ENCRYPTED_FILE);
}

function plaintextPath() {
  return path.join(storageDir(), PLAINTEXT_FILE);
}

function hostKey(webUrl) {
  try {
    // Hostname only so HTTP↔HTTPS for the same server share one session.
    return new URL(webUrl).hostname.toLowerCase();
  } catch {
    return String(webUrl || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
}

function ensureDir() {
  const dir = storageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function isEncryptionAvailable() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

/** @returns {Record<string, { accessToken: string, refreshToken: string, updatedAt: number }>} */
function loadAll() {
  ensureDir();
  try {
    if (isEncryptionAvailable() && fs.existsSync(encryptedPath())) {
      const buf = fs.readFileSync(encryptedPath());
      const json = safeStorage.decryptString(buf);
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === "object" ? parsed : {};
    }
  } catch (err) {
    console.warn("[qchat-desktop] failed to read encrypted session store:", err?.message || err);
  }
  try {
    if (fs.existsSync(plaintextPath())) {
      const parsed = JSON.parse(fs.readFileSync(plaintextPath(), "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    }
  } catch (err) {
    console.warn("[qchat-desktop] failed to read plaintext session store:", err?.message || err);
  }
  return {};
}

/** @param {Record<string, unknown>} all */
function saveAll(all) {
  ensureDir();
  const json = JSON.stringify(all);
  if (isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(encryptedPath(), encrypted, { mode: 0o600 });
    try {
      if (fs.existsSync(plaintextPath())) fs.unlinkSync(plaintextPath());
    } catch {
      /* ignore */
    }
    return;
  }
  console.warn(
    "[qchat-desktop] safeStorage encryption unavailable; session tokens stored as plaintext in userData/secure/"
  );
  fs.writeFileSync(plaintextPath(), json, { encoding: "utf8", mode: 0o600 });
}

/**
 * @param {string} webUrl
 * @returns {{ accessToken: string, refreshToken: string } | null}
 */
function getSecureSession(webUrl) {
  const key = hostKey(webUrl);
  if (!key) return null;
  const entry = loadAll()[key];
  if (!entry?.accessToken) return null;
  return {
    accessToken: String(entry.accessToken),
    refreshToken: String(entry.refreshToken || ""),
  };
}

function hasSecureSession(webUrl) {
  return Boolean(getSecureSession(webUrl)?.accessToken);
}

/**
 * @param {string} webUrl
 * @param {{ accessToken: string, refreshToken?: string }} tokens
 */
function setSecureSession(webUrl, tokens) {
  const key = hostKey(webUrl);
  if (!key) throw new Error("secure session: invalid web URL");
  const accessToken = String(tokens?.accessToken || "").trim();
  if (!accessToken) {
    clearSecureSession(webUrl);
    return;
  }
  const all = loadAll();
  all[key] = {
    accessToken,
    refreshToken: String(tokens?.refreshToken || "").trim(),
    updatedAt: Date.now(),
  };
  saveAll(all);
}

function clearSecureSession(webUrl) {
  const key = hostKey(webUrl);
  if (!key) return;
  const all = loadAll();
  if (!(key in all)) return;
  delete all[key];
  saveAll(all);
}

module.exports = {
  isEncryptionAvailable,
  getSecureSession,
  hasSecureSession,
  setSecureSession,
  clearSecureSession,
  hostKey,
};
