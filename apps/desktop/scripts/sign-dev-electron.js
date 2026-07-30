#!/usr/bin/env node
/**
 * Electron 42+ uses UNNotification on macOS, which requires a real code
 * signature (not linker-signed / bare ad-hoc) for banners to appear.
 *
 * `show` can fire while Notification Center still drops the toast when the
 * binary is only ad-hoc signed. A stable self-signed "Electron Dev" identity
 * fixes local `npm start` without an Apple Developer account.
 *
 * Packaged DMGs use electron-builder signing (PACK-05) — this script is
 * unpackaged-dev only.
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON_APP = path.join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);
const DEFAULT_IDENTITY = "Electron Dev";
const P12_PASS = "qchat-electron-dev";

function codesignInfo(appPath) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function listCodeSignIdentities() {
  try {
    return execFileSync(
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      { encoding: "utf8" }
    );
  } catch (err) {
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
}

function hasIdentity(name) {
  const list = listCodeSignIdentities();
  return list.includes(`"${name}"`);
}

function certificateExistsInKeychain(name) {
  try {
    execFileSync(
      "security",
      ["find-certificate", "-c", name],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return true;
  } catch {
    return false;
  }
}

function loginKeychainPath() {
  try {
    const out = execFileSync("security", ["login-keychain"], {
      encoding: "utf8",
    }).trim();
    // `" /Users/.../login.keychain-db"`
    const m = out.match(/"([^"]+)"/);
    return m ? m[1] : path.join(os.homedir(), "Library/Keychains/login.keychain-db");
  } catch {
    return path.join(os.homedir(), "Library/Keychains/login.keychain-db");
  }
}

/**
 * Create a free self-signed code-signing cert in the login keychain.
 * Requires Trust → Code Signing = Always Trust in Keychain Access before
 * `security find-identity -p codesigning` lists it.
 */
function ensureElectronDevCertificate(identity = DEFAULT_IDENTITY) {
  if (hasIdentity(identity)) {
    return { ok: true, created: false, identity };
  }

  // Already imported earlier but not trusted — do not keep adding duplicates.
  if (certificateExistsInKeychain(identity)) {
    return {
      ok: false,
      untrusted: true,
      identity,
      reason:
        `"${identity}" is in Keychain but not trusted for code signing. ` +
        `Optional: Keychain Access → My Certificates → "${identity}" → ` +
        `Trust → Code Signing = Always Trust, then npm run sign:dev -- --force`,
    };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qchat-electron-dev-"));
  const cnf = path.join(tmp, "cert.cnf");
  const key = path.join(tmp, "key.pem");
  const cert = path.join(tmp, "cert.pem");
  const p12 = path.join(tmp, "cert.p12");
  const keychain = loginKeychainPath();

  try {
    fs.writeFileSync(
      cnf,
      [
        "[req]",
        "distinguished_name = req_distinguished_name",
        "x509_extensions = v3_code",
        "prompt = no",
        "[req_distinguished_name]",
        `CN = ${identity}`,
        "[v3_code]",
        "basicConstraints = CA:FALSE",
        "keyUsage = critical, digitalSignature",
        "extendedKeyUsage = critical, codeSigning",
        "",
      ].join("\n")
    );

    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-new",
        "-nodes",
        "-days",
        "3650",
        "-keyout",
        key,
        "-out",
        cert,
        "-config",
        cnf,
        "-extensions",
        "v3_code",
      ],
      { stdio: "pipe" }
    );

    // macOS `security import` rejects modern OpenSSL 3 PKCS#12 defaults.
    execFileSync(
      "openssl",
      [
        "pkcs12",
        "-export",
        "-out",
        p12,
        "-inkey",
        key,
        "-in",
        cert,
        "-passout",
        `pass:${P12_PASS}`,
        "-name",
        identity,
        "-certpbe",
        "PBE-SHA1-3DES",
        "-keypbe",
        "PBE-SHA1-3DES",
        "-macalg",
        "sha1",
      ],
      { stdio: "pipe" }
    );

    execFileSync(
      "security",
      [
        "import",
        p12,
        "-k",
        keychain,
        "-P",
        P12_PASS,
        "-T",
        "/usr/bin/codesign",
        "-T",
        "/usr/bin/security",
      ],
      { stdio: "pipe" }
    );

    try {
      execFileSync(
        "security",
        [
          "set-key-partition-list",
          "-S",
          "apple-tool:,apple:,codesign:",
          "-s",
          "-k",
          "",
          keychain,
        ],
        { stdio: "pipe" }
      );
    } catch {
      /* empty keychain password / ACL already set — ok */
    }

    if (!hasIdentity(identity)) {
      return {
        ok: false,
        untrusted: true,
        identity,
        reason:
          `Imported "${identity}" but it is not trusted for code signing yet. ` +
          `Optional: Keychain Access → Trust → Code Signing = Always Trust, then ` +
          `npm run sign:dev -- --force`,
      };
    }

    return { ok: true, created: true, identity };
  } catch (err) {
    return {
      ok: false,
      identity,
      reason: `failed to create "${identity}": ${err?.message || err}`,
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function pickIdentity() {
  const forced = (
    process.env.QCHAT_ELECTRON_DEV_IDENTITY ||
    process.env.CSC_NAME ||
    ""
  ).trim();
  if (forced) return forced;

  const preferred = [DEFAULT_IDENTITY, "Qchat Electron Dev"];
  for (const name of preferred) {
    if (hasIdentity(name)) return name;
  }
  return null;
}

function needsResign(info, identity) {
  if (/linker-signed/i.test(info)) return true;
  if (/code object is not signed/i.test(info)) return true;
  // Ad-hoc alone can emit `show` without a visible banner — upgrade when we
  // have (or can create) a named identity.
  if (identity && identity !== "-" && /Signature=adhoc\b/i.test(info)) {
    if (!/Authority=/i.test(info)) return true;
  }
  if (identity && identity !== "-") {
    // Re-sign if not signed by our preferred identity.
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`Authority=${escaped}`).test(info)) return true;
  }
  return false;
}

function signDevElectron({ force = false, ensureCert = true } = {}) {
  if (process.platform !== "darwin") {
    return { ok: true, skipped: true, reason: "not darwin" };
  }
  if (!fs.existsSync(ELECTRON_APP)) {
    return { ok: false, reason: `missing ${ELECTRON_APP}` };
  }

  let identity =
    (
      process.env.QCHAT_ELECTRON_DEV_IDENTITY ||
      process.env.CSC_NAME ||
      ""
    ).trim() || null;

  let certNote = "";
  if (!identity && ensureCert) {
    const ensured = ensureElectronDevCertificate(DEFAULT_IDENTITY);
    if (ensured.ok) {
      if (ensured.created) {
        console.log(
          `[qchat-desktop] created self-signed codesigning identity "${ensured.identity}"`
        );
      }
      identity = ensured.identity;
    } else {
      // Unpackaged builds use the in-app mac toast window; ad-hoc is enough to boot.
      certNote = ensured.reason || "named identity unavailable";
      identity = "-";
    }
  }

  if (!identity) {
    identity = pickIdentity() || "-";
  }

  let info = "";
  try {
    info = codesignInfo(ELECTRON_APP);
  } catch (err) {
    info = String(err?.stderr || err?.message || err);
  }

  if (!force && !needsResign(info, identity)) {
    return {
      ok: true,
      skipped: true,
      reason: `already signed (${identity === "-" ? "ad-hoc" : identity})`,
      identity: identity === "-" ? "ad-hoc" : identity,
      certNote,
    };
  }

  const trySign = (id) => {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", id, ELECTRON_APP],
      { stdio: "pipe" }
    );
  };

  try {
    trySign(identity);
  } catch (err) {
    if (identity !== "-") {
      try {
        trySign("-");
        identity = "-";
        certNote =
          certNote ||
          `codesign with named identity failed (${err?.message || err}); used ad-hoc`;
      } catch (adhocErr) {
        return {
          ok: false,
          reason: `codesign failed: ${adhocErr?.message || adhocErr}`,
        };
      }
    } else {
      return {
        ok: false,
        reason: `codesign failed with ad-hoc: ${err?.message || err}`,
      };
    }
  }

  let after = "";
  try {
    after = codesignInfo(ELECTRON_APP);
  } catch (err) {
    after = String(err?.stderr || err?.message || err);
  }
  if (/linker-signed/i.test(after)) {
    return {
      ok: false,
      reason: "still linker-signed after codesign",
    };
  }

  return {
    ok: true,
    identity: identity === "-" ? "ad-hoc" : identity,
    after,
    certNote,
  };
}

if (require.main === module) {
  const force = process.argv.includes("--force");
  const result = signDevElectron({ force, ensureCert: true });
  if (!result.ok) {
    console.error("[qchat-desktop] sign:dev failed:", result.reason);
    process.exit(1);
  }
  if (result.skipped) {
    console.log("[qchat-desktop] sign:dev skipped:", result.reason);
  } else {
    console.log(
      `[qchat-desktop] signed Electron.app for macOS notifications (${result.identity})`
    );
    console.log(
      "[qchat-desktop] If banners still missing: System Settings → Notifications → Electron → Allow Notifications (Banners)."
    );
  }
}

module.exports = {
  signDevElectron,
  ensureElectronDevCertificate,
  ELECTRON_APP,
  needsResign,
  DEFAULT_IDENTITY,
};
