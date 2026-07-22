const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { readUserConfig, writeUserConfig } = require("../app/configuration/userConfig");

/**
 * Autostart on OS login (SHELL-26).
 * Mirrors Mattermost AutoLauncher: no-op while unpackaged/dev; uses Electron
 * login items on win/mac and an XDG .desktop entry on Linux when packaged.
 */

function linuxAutostartPath() {
  return path.join(os.homedir(), ".config", "autostart", "qchat-desktop.desktop");
}

function linuxAutostartExec() {
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return process.execPath;
}

function syncLinuxAutostart(enabled) {
  const desktopFile = linuxAutostartPath();
  try {
    if (!enabled) {
      if (fs.existsSync(desktopFile)) fs.unlinkSync(desktopFile);
      return;
    }
    fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
    const execPath = linuxAutostartExec();
    const body =
      `[Desktop Entry]\n` +
      `Type=Application\n` +
      `Version=1.0\n` +
      `Name=${APP_TITLE}\n` +
      `Comment=Qchat desktop client\n` +
      `Exec="${execPath}"\n` +
      `Terminal=false\n` +
      `X-GNOME-Autostart-enabled=true\n` +
      `Hidden=false\n`;
    fs.writeFileSync(desktopFile, body, "utf8");
  } catch (err) {
    console.warn("[qchat-desktop] linux autostart sync failed:", err?.message || err);
  }
}

function isLinuxAutostartEnabled() {
  return fs.existsSync(linuxAutostartPath());
}

/** Preferred value from userData/config.json (may be undefined). */
function preferredOpenAtLogin() {
  const value = readUserConfig().openAtLogin;
  return typeof value === "boolean" ? value : undefined;
}

function isAutostartEnabled() {
  if (process.platform === "linux") {
    const pref = preferredOpenAtLogin();
    if (typeof pref === "boolean") return pref;
    return isLinuxAutostartEnabled();
  }
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch {
    return Boolean(preferredOpenAtLogin());
  }
}

/**
 * @param {boolean} enabled
 * @returns {boolean} applied (false in unpackaged/dev — preference still saved)
 */
function setAutostartEnabled(enabled) {
  const next = Boolean(enabled);
  writeUserConfig({ openAtLogin: next });

  if (!app.isPackaged) {
    // Mattermost AutoLauncher: development mode does not touch OS autostart.
    return false;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: next,
      openAsHidden: false,
    });
  } catch (err) {
    console.warn("[qchat-desktop] setLoginItemSettings failed:", err?.message || err);
  }

  if (process.platform === "linux") {
    syncLinuxAutostart(next);
  }

  return true;
}

/** Apply saved preference once the app is ready (packaged builds only). */
function applyStoredAutostart() {
  const pref = preferredOpenAtLogin();
  if (typeof pref !== "boolean") return;
  setAutostartEnabled(pref);
}

module.exports = {
  isAutostartEnabled,
  setAutostartEnabled,
  applyStoredAutostart,
};
