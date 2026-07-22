const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog } = require("electron");
const {
  APP_TITLE,
  WINDOW_STATE_FILE,
  DEFAULT_WINDOW,
} = require("../../shared/constants");
const { IPC } = require("../../shared/ipc/channels");
const { getPreloadPath, iconOption, getDesktopRoot } = require("../app/configuration/paths");
const { resolveStartUrl } = require("../app/configuration/webUrl");
const { attachNavigationGuards } = require("../security/navigation");
const { getTray } = require("../native/tray");
const { isAppQuitting } = require("../app/quitState");
const { hasSecureSession } = require("../secureStorage");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string | null} */
let pendingConversationId = null;

function getMainWindow() {
  return mainWindow;
}

function statePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (
      Number.isFinite(parsed.width) &&
      Number.isFinite(parsed.height) &&
      Number.isFinite(parsed.x ?? 0) &&
      Number.isFinite(parsed.y ?? 0)
    ) {
      return parsed;
    }
  } catch {
    /* ignore missing/corrupt state */
  }
  return { ...DEFAULT_WINDOW };
}

function saveWindowState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  try {
    fs.writeFileSync(statePath(), JSON.stringify(bounds, null, 2));
  } catch {
    /* ignore persistence errors */
  }
}

function focusMainWindow(createIfMissing) {
  if (!mainWindow) {
    if (createIfMissing) createIfMissing();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function sendConversationToRenderer(conversationId) {
  if (!conversationId) return;
  pendingConversationId = conversationId;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.OPEN_CONVERSATION, conversationId);
  }
}

function flushPendingConversation() {
  if (pendingConversationId && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.OPEN_CONVERSATION, pendingConversationId);
  }
}

/**
 * @param {{ webUrl: string, isDev: boolean }} opts
 */
function createMainWindow(opts) {
  const { webUrl, isDev } = opts;
  const startUrl = resolveStartUrl(webUrl, { hasSession: hasSecureSession(webUrl) });
  const saved = loadWindowState();
  const icon = iconOption();
  let appVersion = "0.1.0";
  try {
    appVersion = require(path.join(getDesktopRoot(), "package.json")).version;
  } catch {
    /* keep default */
  }

  mainWindow = new BrowserWindow({
    width: saved.width || DEFAULT_WINDOW.width,
    height: saved.height || DEFAULT_WINDOW.height,
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: false,
    title: APP_TITLE,
    ...(icon ? { icon } : {}),
    backgroundColor: "#0E1621",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      additionalArguments: [
        `--qchat-version=${appVersion}`,
        `--qchat-web-url=${webUrl}`,
      ],
    },
  });

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(APP_TITLE);
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.setTitle(APP_TITLE);
    mainWindow?.show();
  });

  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  // Mattermost minimizeToTray: close button hides to tray instead of quitting.
  mainWindow.on("close", (event) => {
    saveWindowState();
    if (isAppQuitting()) return;
    const tray = getTray();
    if (!tray || tray.isDestroyed()) return;
    event.preventDefault();
    mainWindow.blur();
    mainWindow.hide();
  });

  attachNavigationGuards(mainWindow, webUrl);

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      dialog.showErrorBox(
        "Qchat Desktop",
        `Could not load Qchat web UI.\n\n` +
          `URL: ${validatedURL || webUrl}\n` +
          `Error: ${errorDescription} (${errorCode})\n\n` +
          `Start apps/web (npm run dev) or set QCHAT_WEB_URL, e.g.\n` +
          `QCHAT_WEB_URL=https://135.181.224.36 npm start`
      );
    }
  );

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on("did-finish-load", () => {
    const watchdog = `
      (function () {
        try {
          var path = location.pathname || "/";
          if (path !== "/" && path !== "") return;
          var text = (document.body && document.body.innerText || "").trim();
          if (text !== "Loading…" && text !== "Loading...") return;
          setTimeout(function () {
            var still = (document.body && document.body.innerText || "").trim();
            if (still === "Loading…" || still === "Loading...") {
              location.replace("/login");
            }
          }, 2500);
        } catch (e) {}
      })();
    `;
    mainWindow?.webContents.executeJavaScript(watchdog).catch(() => {});
  });

  mainWindow.loadURL(startUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

module.exports = {
  getMainWindow,
  focusMainWindow,
  createMainWindow,
  sendConversationToRenderer,
  flushPendingConversation,
};
