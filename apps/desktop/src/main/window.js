const fs = require("fs");
const path = require("path");
const { BrowserWindow, dialog, shell } = require("electron");
const {
  APP_ROOT,
  APP_TITLE,
  DEFAULT_WINDOW,
  ICON_PATH,
} = require("./constants");
const { loadWindowState, saveWindowState } = require("./window-state");

const LOADING_WATCHDOG = `
  (() => {
    if (location.pathname !== "/") return;
    const loading = () => ["Loading…", "Loading..."].includes(document.body.innerText.trim());
    if (!loading()) return;
    setTimeout(() => {
      if (loading()) location.replace("/login");
    }, 2500);
  })();
`;

function openExternalHttpUrl(url) {
  try {
    const target = new URL(url);
    if (["http:", "https:"].includes(target.protocol)) shell.openExternal(url);
  } catch {
    // Invalid popup targets are denied.
  }
}

function createMainWindow({ isDev, startUrl, webUrl }) {
  const saved = loadWindowState();
  const allowedOrigin = new URL(webUrl).origin;
  const window = new BrowserWindow({
    width: saved.width || DEFAULT_WINDOW.width,
    height: saved.height || DEFAULT_WINDOW.height,
    x: saved.x,
    y: saved.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: false,
    title: APP_TITLE,
    ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    backgroundColor: "#0E1621",
    webPreferences: {
      preload: path.join(APP_ROOT, "src", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      additionalArguments: [
        `--qchat-version=${require(path.join(APP_ROOT, "package.json")).version}`,
        `--qchat-web-url=${webUrl}`,
      ],
    },
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_TITLE);
  });
  window.once("ready-to-show", () => {
    window.setTitle(APP_TITLE);
    window.show();
  });
  window.on("resize", () => saveWindowState(window));
  window.on("move", () => saveWindowState(window));
  window.on("close", () => saveWindowState(window));

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin === allowedOrigin) return;
    } catch {
      // Invalid navigation targets are denied.
    }
    event.preventDefault();
    openExternalHttpUrl(url);
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      dialog.showErrorBox(
        APP_TITLE,
        `Could not load Qchat web UI.\n\n` +
          `URL: ${validatedURL || webUrl}\n` +
          `Error: ${errorDescription} (${errorCode})\n\n` +
          "Run npm run dev from apps/desktop to start the web UI automatically.",
      );
    },
  );

  window.webContents.on("did-finish-load", () => {
    window.webContents.executeJavaScript(LOADING_WATCHDOG).catch(() => {});
  });

  if (isDev) window.webContents.openDevTools({ mode: "detach" });
  window.loadURL(startUrl);
  return window;
}

module.exports = { createMainWindow };
