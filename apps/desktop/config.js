const fs = require("fs");
const path = require("path");

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

/** Resolve web UI origin: --url CLI > QCHAT_WEB_URL > .env > localhost:3000 */
function resolveWebUrl() {
  loadEnvFile(path.join(__dirname, ".env"));

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-sandbox") continue;
    if (a.startsWith("--url=")) return a.slice("--url=".length).trim().replace(/\/$/, "");
    if (a === "--url" && argv[i + 1]) return String(argv[i + 1]).trim().replace(/\/$/, "");
  }

  const fromEnv = (process.env.QCHAT_WEB_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  return "http://localhost:3000";
}

module.exports = { resolveWebUrl, loadEnvFile };
