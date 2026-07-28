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

const publish = Array.isArray(build.publish) ? build.publish : [];
assert(publish.length >= 1, "build.publish must define at least one provider");
assert(
  publish[0] && publish[0].provider === "generic",
  "build.publish[0].provider must be generic (runtime feed still uses updateUrl)"
);
assert(
  publish[0] && typeof publish[0].url === "string" && publish[0].url.includes("desktop-updates"),
  "build.publish[0].url should point at a /desktop-updates/ style feed (placeholder OK)"
);

const wineScript = path.join(ROOT, "scripts/dist-win-docker.sh");
assert(fs.existsSync(wineScript), "scripts/dist-win-docker.sh missing (PACK-02)");
assert(
  pkg.scripts && typeof pkg.scripts["dist:win:docker"] === "string",
  "package.json scripts.dist:win:docker required"
);

console.log("signing scaffold: ok");
