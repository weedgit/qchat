const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const {
  APP_TITLE,
} = require("../../shared/constants");
const { getPreloadPath, iconOption, getDesktopRoot } = require("../app/configuration/paths");
const { attachNavigationGuards } = require("../security/navigation");
const { attachContextMenu } = require("../native/contextMenu");

const CALL_STATE_FILE = "call-window-state.json";
const DEFAULT_CALL_WINDOW = { width: 1100, height: 720 };

/** @type {BrowserWindow | null} */
let callWindow = null;

function callStatePath() {
  return path.join(app.getPath("userData"), CALL_STATE_FILE);
}

function loadCallWindowState() {
  try {
    const raw = fs.readFileSync(callStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CALL_WINDOW };
}

/**
 * @param {BrowserWindow} win
 */
function persistCallWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    const payload = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    };
    fs.writeFileSync(callStatePath(), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function getCallWindow() {
  return callWindow && !callWindow.isDestroyed() ? callWindow : null;
}

function focusCallWindow() {
  const win = getCallWindow();
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

function closeCallWindow() {
  const win = getCallWindow();
  if (!win) return false;
  win.close();
  return true;
}

/**
 * Telegram-style dedicated video chat window (resizable + fullscreen).
 * @param {{ webUrl: string, path?: string }} opts
 */
function openCallWindow(opts) {
  const webUrl = String(opts?.webUrl || "").replace(/\/$/, "");
  const relPath = String(opts?.path || "/call").startsWith("/")
    ? String(opts?.path || "/call")
    : `/${opts?.path || "call"}`;
  if (!webUrl) return { ok: false };

  const target = `${webUrl}${relPath}`;
  const existing = getCallWindow();
  if (existing) {
    existing.loadURL(target).catch(() => {});
    focusCallWindow();
    return { ok: true };
  }

  const saved = loadCallWindowState();
  const icon = iconOption();
  let appVersion = "0.1.0";
  try {
    appVersion = require(path.join(getDesktopRoot(), "package.json")).version;
  } catch {
    /* keep default */
  }

  callWindow = new BrowserWindow({
    width: saved.width || DEFAULT_CALL_WINDOW.width,
    height: saved.height || DEFAULT_CALL_WINDOW.height,
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    minWidth: 640,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    title: `${APP_TITLE} Video Chat`,
    fullscreenable: true,
    maximizable: true,
    resizable: true,
    backgroundColor: "#0B1118",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [
        `--qchat-version=${appVersion}`,
        `--qchat-web-url=${webUrl}`,
        "--qchat-call-window=1",
      ],
    },
  });

  if (saved.isMaximized) {
    callWindow.maximize();
  }

  attachNavigationGuards(callWindow, webUrl);
  attachContextMenu(callWindow);

  callWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    if (callWindow && !callWindow.isDestroyed()) {
      callWindow.setTitle(`${APP_TITLE} Video Chat`);
    }
  });

  const persist = () => persistCallWindowState(callWindow);
  callWindow.on("resize", persist);
  callWindow.on("move", persist);
  callWindow.on("close", persist);
  callWindow.on("closed", () => {
    callWindow = null;
  });

  callWindow.once("ready-to-show", () => {
    if (!callWindow || callWindow.isDestroyed()) return;
    callWindow.show();
    callWindow.focus();
  });

  callWindow.loadURL(target).catch((err) => {
    console.warn("[qchat-desktop] call window load failed:", err?.message || err);
  });

  return { ok: true };
}

module.exports = {
  openCallWindow,
  focusCallWindow,
  closeCallWindow,
  getCallWindow,
};
