#!/usr/bin/env node
/**
 * Electron 42+ uses UNNotification on macOS, which rejects linker-signed
 * binaries (UNErrorDomain error 1 / NotificationsNotAllowed).
 *
 * npm start runs node_modules/electron/dist/Electron.app — re-sign it for
 * local notification testing. Prefer a stable "Electron Dev" identity when
 * present; otherwise ad-hoc (`codesign --sign -`) is enough for toasts.
 *
 * Packaged DMGs use electron-builder signing (PACK-05) — this script is
 * unpackaged-dev only.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON_APP = path.join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);

function codesignInfo(appPath) {
  // codesign -dv writes details to stderr and exits 0.
  const { spawnSync } = require("child_process");
  const result = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function pickIdentity() {
  const forced = (
    process.env.QCHAT_ELECTRON_DEV_IDENTITY ||
    process.env.CSC_NAME ||
    ""
  ).trim();
  if (forced) return forced;

  try {
    const list = execFileSync(
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      { encoding: "utf8" }
    );
    const preferred = ['"Electron Dev"', '"Qchat Electron Dev"'];
    for (const name of preferred) {
      if (list.includes(name)) return name.slice(1, -1);
    }
  } catch {
    /* no identities */
  }
  return "-"; // ad-hoc
}

function needsResign(info) {
  // Stock Electron ships as adhoc,linker-signed — UNNotification rejects that.
  if (/linker-signed/i.test(info)) return true;
  // Missing signature entirely
  if (/code object is not signed/i.test(info)) return true;
  return false;
}

function signDevElectron({ force = false } = {}) {
  if (process.platform !== "darwin") {
    return { ok: true, skipped: true, reason: "not darwin" };
  }
  if (!fs.existsSync(ELECTRON_APP)) {
    return { ok: false, reason: `missing ${ELECTRON_APP}` };
  }

  let info = "";
  try {
    info = codesignInfo(ELECTRON_APP);
  } catch (err) {
    info = String(err?.stderr || err?.message || err);
  }

  if (!force && !needsResign(info)) {
    return { ok: true, skipped: true, reason: "already signed for UNNotification" };
  }

  const identity = pickIdentity();
  try {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", identity, ELECTRON_APP],
      { stdio: "inherit" }
    );
  } catch (err) {
    return {
      ok: false,
      reason: `codesign failed: ${err?.message || err}`,
    };
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
      reason: "still linker-signed after codesign — notifications will fail",
    };
  }

  return {
    ok: true,
    identity: identity === "-" ? "ad-hoc" : identity,
    after,
  };
}

if (require.main === module) {
  const force = process.argv.includes("--force");
  const result = signDevElectron({ force });
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
  }
}

module.exports = { signDevElectron, ELECTRON_APP, needsResign };
