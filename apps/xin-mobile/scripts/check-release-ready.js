#!/usr/bin/env node
/**
 * Pre-flight checks for XinChat mobile release / EAS profiles.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

if (!exists("eas.json")) errors.push("missing eas.json");
if (!exists("app.config.js")) errors.push("missing app.config.js");
if (!exists(".easignore")) warnings.push("missing .easignore");

let eas;
try {
  eas = JSON.parse(read("eas.json"));
} catch (e) {
  errors.push(`eas.json parse failed: ${e.message}`);
}

if (eas?.build?.production?.env?.XINCHAT_TRUST_CERT !== "0") {
  errors.push("production profile must set XINCHAT_TRUST_CERT=0");
}
if (eas?.build?.production?.env?.XINCHAT_ALLOW_CLEARTEXT !== "0") {
  errors.push("production profile must set XINCHAT_ALLOW_CLEARTEXT=0");
}
if (eas?.build?.production?.env?.APP_ENV !== "production") {
  errors.push("production profile must set APP_ENV=production");
}

for (const name of [
  "credentials.json",
  "google-services.json",
  "GoogleService-Info.plist",
]) {
  if (exists(name)) {
    errors.push(`${name} must not be committed — use EAS credentials`);
  }
}

process.env.APP_ENV = "production";
process.env.XINCHAT_TRUST_CERT = "0";
process.env.XINCHAT_ALLOW_CLEARTEXT = "0";
delete require.cache[require.resolve("../app.config.js")];
const prodConfig = require("../app.config.js");
const plugins = prodConfig.plugins || [];
const pluginStr = JSON.stringify(plugins);
if (pluginStr.includes("withTrustedQchatCert")) {
  errors.push("production app.config still includes withTrustedQchatCert");
}
if (pluginStr.includes("expo-dev-client")) {
  errors.push("production app.config still includes expo-dev-client");
}
const buildProps = plugins.find(
  (p) => Array.isArray(p) && p[0] === "expo-build-properties"
);
if (buildProps?.[1]?.android?.usesCleartextTraffic) {
  errors.push("production must not enable android.usesCleartextTraffic");
}
if (!prodConfig.android?.package || prodConfig.android.package !== "com.xinchat.mobile") {
  errors.push("android.package must be com.xinchat.mobile");
}
if (!prodConfig.ios?.bundleIdentifier || prodConfig.ios.bundleIdentifier !== "com.xinchat.mobile") {
  errors.push("ios.bundleIdentifier must be com.xinchat.mobile");
}
if (!prodConfig.android?.versionCode) {
  errors.push("android.versionCode missing");
}
if (!prodConfig.ios?.buildNumber) {
  errors.push("ios.buildNumber missing");
}

if (!process.env.EAS_PROJECT_ID && !prodConfig.extra?.eas?.projectId) {
  warnings.push(
    "EAS projectId unset — run `npx eas-cli init` in apps/xin-mobile and set EAS_PROJECT_ID"
  );
}

console.log("XinChat mobile release-ready check");
console.log(`  profile simulation: production`);
for (const w of warnings) console.warn(`  warn: ${w}`);
for (const e of errors) console.error(`  error: ${e}`);

if (errors.length) {
  console.error(`\nFailed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("\nOK — XinChat production profile looks gated for store builds.");
process.exit(0);
