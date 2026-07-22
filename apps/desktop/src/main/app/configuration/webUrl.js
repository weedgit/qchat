const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const {
  DEFAULT_DEV_URL,
  DEFAULT_PROD_URL,
} = require("../../../shared/constants");
const {
  getEnvFilePath,
  getProductionConfigPath,
} = require("./paths");

/**
 * Load KEY=VALUE pairs from a .env file without overriding existing env vars.
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function isPackagedApp() {
  return Boolean(app?.isPackaged);
}

function readJsonWebUrl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return String(raw?.webUrl || raw?.QCHAT_WEB_URL || "")
      .trim()
      .replace(/\/$/, "");
  } catch {
    return "";
  }
}

function userConfigPath() {
  try {
    return path.join(app.getPath("userData"), "config.json");
  } catch {
    return "";
  }
}

/**
 * Resolve web UI origin.
 * Precedence:
 *   1. --url CLI
 *   2. QCHAT_WEB_URL env (including values loaded from `.env`)
 *   3. If packaged: userData/config.json → production.json → DEFAULT_PROD_URL
 *   4. If unpackaged: DEFAULT_DEV_URL (localhost:3000)
 */
function resolveWebUrl() {
  loadEnvFile(getEnvFilePath());

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-sandbox") continue;
    if (a.startsWith("--url=")) {
      return a.slice("--url=".length).trim().replace(/\/$/, "");
    }
    if (a === "--url" && argv[i + 1]) {
      return String(argv[i + 1]).trim().replace(/\/$/, "");
    }
  }

  const fromEnv = (process.env.QCHAT_WEB_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (isPackagedApp()) {
    const userCfg = userConfigPath();
    if (userCfg) {
      const fromUser = readJsonWebUrl(userCfg);
      if (fromUser) return fromUser;
    }
    const fromProduction = readJsonWebUrl(getProductionConfigPath());
    if (fromProduction) return fromProduction;
    return DEFAULT_PROD_URL;
  }

  return DEFAULT_DEV_URL;
}

/**
 * Start at app root. The web auth gate sends unsigned users to /login.
 * Always forcing /login broke "remember me" when tokens already lived in
 * Chromium localStorage (typical for start:server / packaged remote web).
 */
function resolveStartUrl(base, opts = {}) {
  void opts; // hasSession reserved; root load + inject handles restore
  try {
    const u = new URL(base);
    if (!u.pathname || u.pathname === "/" || u.pathname === "/login") {
      return `${u.origin}/`;
    }
    return u.toString();
  } catch {
    return String(base).replace(/\/$/, "") + "/";
  }
}

module.exports = {
  resolveWebUrl,
  resolveStartUrl,
  loadEnvFile,
  isPackagedApp,
  DEFAULT_DEV_URL,
  DEFAULT_PROD_URL,
};
