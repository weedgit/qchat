/**
 * PACK-04 / PACK-05 — signing scaffold sanity checks (no secrets required).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("signing check failed:", msg);
    process.exit(1);
  }
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
);
const build = pkg.build || {};

assert(build.forceCodeSigning !== true, "forceCodeSigning must not be true (unsigned builds must work)");
assert(build.afterSign, "afterSign hook required for optional notarize");
const winSign = build.win && build.win.signtoolOptions;
assert(
  winSign &&
    Array.isArray(winSign.signingHashAlgorithms) &&
    winSign.signingHashAlgorithms.includes("sha256"),
  "win.signtoolOptions.signingHashAlgorithms must include sha256"
);
assert(
  winSign && winSign.rfc3161TimeStampServer,
  "win.signtoolOptions.rfc3161TimeStampServer must be set for Authenticode timestamps"
);
assert(build.mac && build.mac.hardenedRuntime === true, "mac.hardenedRuntime required");
assert(
  build.mac && build.mac.notarize === false,
  "mac.notarize must be false (custom afterSign handles notarize when creds exist)"
);

const entitlements = path.join(ROOT, "assets", "entitlements.mac.plist");
assert(fs.existsSync(entitlements), "assets/entitlements.mac.plist missing");
assert(
  String(build.mac.entitlements || "").includes("entitlements.mac.plist"),
  "mac.entitlements must point at entitlements.mac.plist"
);

const afterSign = fs.readFileSync(
  path.join(ROOT, "scripts/afterSign.js"),
  "utf8"
);
assert(
  afterSign.includes("APPLE_TEAM_ID") && afterSign.includes("notarize"),
  "afterSign.js must gate notarize on Apple credentials"
);

console.log("signing scaffold: ok");
