const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function userConfigPath() {
  try {
    return path.join(app.getPath("userData"), "config.json");
  } catch {
    return "";
  }
}

function readUserConfig() {
  const filePath = userConfigPath();
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeUserConfig(patch) {
  const filePath = userConfigPath();
  if (!filePath) return;
  try {
    const next = { ...readUserConfig(), ...patch };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
  } catch {
    /* ignore persistence errors */
  }
}

module.exports = {
  userConfigPath,
  readUserConfig,
  writeUserConfig,
};
