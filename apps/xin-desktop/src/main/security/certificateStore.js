const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const STORE_FILE = "certificate.json";

/**
 * Persist trusted / explicitly untrusted certificates by origin (SHELL-30).
 * Mirrors Mattermost Desktop certificateStore.ts.
 */
class CertificateStore {
  constructor(storeFile) {
    this.storeFile = storeFile;
    this.data = {};
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.storeFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.data = parsed;
      }
    } catch {
      this.data = {};
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
      fs.writeFileSync(this.storeFile, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.warn(
        "[xinchat-desktop] certificate store save failed:",
        err?.message || err
      );
    }
  }

  /**
   * @param {URL} targetURL
   * @param {Electron.Certificate} certificate
   * @param {boolean} [dontTrust]
   */
  add(targetURL, certificate, dontTrust = false) {
    const entry = comparableCertificate(certificate, dontTrust);
    this.data[targetURL.origin] = entry;
    if (targetURL.origin.startsWith("https://")) {
      this.data[targetURL.origin.replace("https://", "wss://")] = entry;
    }
  }

  /** @param {URL} targetURL */
  isExisting(targetURL) {
    return Object.prototype.hasOwnProperty.call(this.data, targetURL.origin);
  }

  /**
   * @param {URL} targetURL
   * @param {Electron.Certificate} certificate
   */
  isTrusted(targetURL, certificate) {
    if (!this.isExisting(targetURL)) return false;
    const stored = this.data[targetURL.origin];
    if (stored?.dontTrust) return false;
    return areEqual(stored, comparableCertificate(certificate));
  }

  /** @param {URL} targetURL */
  isExplicitlyUntrusted(targetURL) {
    return Boolean(this.data[targetURL.origin]?.dontTrust);
  }
}

/**
 * @param {Electron.Certificate} certificate
 * @param {boolean} [dontTrust]
 */
function comparableCertificate(certificate, dontTrust = false) {
  const buf = certificate?.data;
  const data =
    Buffer.isBuffer(buf)
      ? buf.toString("base64")
      : buf != null
        ? String(buf)
        : "";
  return {
    data,
    issuerName: String(certificate?.issuerName || ""),
    dontTrust: Boolean(dontTrust),
  };
}

/**
 * @param {{ data?: string, issuerName?: string }} a
 * @param {{ data?: string, issuerName?: string }} b
 */
function areEqual(a, b) {
  return a?.data === b?.data && a?.issuerName === b?.issuerName;
}

function certificateStorePath() {
  return path.join(app.getPath("userData"), STORE_FILE);
}

/** Lazy singleton — path needs app.getPath (after app is available). */
let store = null;

function getCertificateStore() {
  if (!store) {
    store = new CertificateStore(certificateStorePath());
  }
  return store;
}

module.exports = {
  CertificateStore,
  getCertificateStore,
  comparableCertificate,
};
