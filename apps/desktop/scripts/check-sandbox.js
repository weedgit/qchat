/**
 * PACK-07 sanity checks (no Electron runtime required).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("sandbox check failed:", msg);
    process.exit(1);
  }
}

const indexJs = fs.readFileSync(
  path.join(ROOT, "src/main/index.js"),
  "utf8"
);
assert(
  indexJs.includes("enableProductionSandbox"),
  "main entry must call enableProductionSandbox before startApp"
);

const sandboxJs = fs.readFileSync(
  path.join(ROOT, "src/main/security/sandbox.js"),
  "utf8"
);
assert(
  sandboxJs.includes("enableSandbox"),
  "sandbox.js must call app.enableSandbox"
);
assert(
  sandboxJs.includes("isPackaged"),
  "packaged builds must ignore QCHAT_DESKTOP_NO_SANDBOX"
);

const launchJs = fs.readFileSync(path.join(ROOT, "scripts/launch.js"), "utf8");
assert(
  launchJs.includes("QCHAT_DESKTOP_NO_SANDBOX"),
  "launch.js must gate --no-sandbox on explicit env/flag"
);
assert(
  launchJs.includes("dev/VM only") || launchJs.includes("packaged"),
  "launch.js must warn that --no-sandbox is not for packaged releases"
);

const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
);
assert(
  pkg.build && pkg.build.afterPack,
  "electron-builder afterPack must be configured for chrome-sandbox setuid"
);

const afterPack = fs.readFileSync(
  path.join(ROOT, "scripts/afterPack.js"),
  "utf8"
);
assert(
  afterPack.includes("chrome-sandbox") && afterPack.includes("4755"),
  "afterPack must chmod chrome-sandbox to 4755 on Linux"
);

const mainWindow = fs.readFileSync(
  path.join(ROOT, "src/main/windows/mainWindow.js"),
  "utf8"
);
assert(
  /sandbox:\s*true/.test(mainWindow),
  "BrowserWindow must keep webPreferences.sandbox: true"
);

const preload = fs.readFileSync(
  path.join(ROOT, "src/preload/index.js"),
  "utf8"
);
const preloadRequires = [...preload.matchAll(/require\((["'])([^"']+)\1\)/g)].map(
  (match) => match[2]
);
assert(
  preloadRequires.every((moduleName) => moduleName === "electron"),
  `sandboxed preload may only require Electron (found: ${preloadRequires.join(", ")})`
);
assert(
  !preload.includes('require("os")') && !preload.includes("require('os')"),
  "sandboxed preload must receive OS metadata from main"
);

console.log("sandbox hardening: ok");
