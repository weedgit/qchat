const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const {
  getEnvFilePath,
  getProductionConfigPath,
} = require("./paths");

/**
 * Load KEY=VALUE from .env without overriding existing env (same idea as webUrl).
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
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function readJsonUpdateUrl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return String(raw?.updateUrl || raw?.QCHAT_UPDATE_URL || "")
      .trim()
      .replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * Update feed base URL (generic provider). Empty = auto-update disabled.
 * Precedence: QCHAT_UPDATE_URL → userData/config.json → production.json
 */
function resolveUpdateUrl() {
  try {
    loadEnvFile(getEnvFilePath());
  } catch {
    /* ignore */
  }

  const fromEnv = String(process.env.QCHAT_UPDATE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  try {
    const userCfg = path.join(app.getPath("userData"), "config.json");
    const fromUser = readJsonUpdateUrl(userCfg);
    if (fromUser) return fromUser;
  } catch {
    /* ignore */
  }

  return readJsonUpdateUrl(getProductionConfigPath());
}

module.exports = { resolveUpdateUrl };
