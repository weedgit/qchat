const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { APP_ROOT } = require("./constants");

const DEFAULT_DEV_URL = "http://localhost:3000";
const DEFAULT_PROD_URL = "http://135.181.224.36";

function normalizeUrl(value) {
  return String(value).trim().replace(/\/$/, "");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readJsonWebUrl(filePath) {
  try {
    const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeUrl(config.webUrl || config.QCHAT_WEB_URL || "");
  } catch {
    return "";
  }
}

function commandLineUrl() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--url=")) return normalizeUrl(argument.slice(6));
    if (argument === "--url" && args[index + 1]) return normalizeUrl(args[index + 1]);
  }
  return "";
}

function resolveWebUrl() {
  loadEnvFile(path.join(APP_ROOT, ".env"));

  const fromCommandLine = commandLineUrl();
  if (fromCommandLine) return fromCommandLine;

  const fromEnvironment = normalizeUrl(process.env.QCHAT_WEB_URL || "");
  if (fromEnvironment) return fromEnvironment;

  if (!app.isPackaged) return DEFAULT_DEV_URL;

  const fromUserConfig = readJsonWebUrl(path.join(app.getPath("userData"), "config.json"));
  if (fromUserConfig) return fromUserConfig;

  return (
    readJsonWebUrl(path.join(APP_ROOT, "production.json")) ||
    DEFAULT_PROD_URL
  );
}

function resolveStartUrl(webUrl) {
  const url = new URL(webUrl);
  if (url.pathname === "/") url.pathname = "/login";
  return url.toString().replace(/\/$/, "");
}

function isDevelopment() {
  return process.argv.includes("--dev") || process.env.QCHAT_DESKTOP_DEV === "1";
}

module.exports = {
  DEFAULT_DEV_URL,
  DEFAULT_PROD_URL,
  isDevelopment,
  loadEnvFile,
  resolveStartUrl,
  resolveWebUrl,
};
