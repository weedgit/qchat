const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow, dialog } = require("electron");
const {
  APP_TITLE,
  WINDOW_STATE_FILE,
  DEFAULT_WINDOW,
} = require("../../shared/constants");
const { IPC } = require("../../shared/ipc/channels");
const { getPreloadPath, iconOption, getDesktopRoot } = require("../app/configuration/paths");
const { attachNavigationGuards } = require("../security/navigation");
const { getTray } = require("../native/tray");
const { isAppQuitting } = require("../app/quitState");
const { hasSecureSession } = require("../secureStorage");
const {
  attachSessionPersistence,
  prepareEarlySessionBootstrap,
} = require("./sessionPersistence");
const { ensureVaultSessionFresh } = require("./sessionValidate");
const { attachContextMenu } = require("../native/contextMenu");
const { attachWindowFocusBridge } = require("../ipc/handlers/windowFocus");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string | null} */
let pendingConversationId = null;
/** @type {(() => void) | null} */
let detachWindowFocusBridge = null;

/** Friendly OS label computed in main because sandboxed preloads cannot require("os"). */
function platformLabel() {
  const release = os.release();
  if (process.platform === "win32") {
    const build = parseInt(String(release).split(".")[2] || "0", 10);
    if (build >= 22000) return "Windows 11";
    if (String(release).startsWith("10.")) return "Windows 10";
    return `Windows (${release})`;
  }
  if (process.platform === "darwin") {
    const version = typeof os.version === "function" ? os.version() : "";
    return version || `macOS (${release})`;
  }
  if (process.platform === "linux") {
    const version = typeof os.version === "function" ? String(os.version() || "") : "";
    const ubuntu = version.match(/ubuntu[^0-9]*([\d.]+)/i);
    if (ubuntu) return `Ubuntu ${ubuntu[1]}`;
    return version && version !== "Linux" ? version : `Linux (${release})`;
  }
  return `${process.platform} (${release})`;
}

function getMainWindow() {
  return mainWindow;
}

/**
 * loadURL that swallows transient ERR_FAILED / ERR_ABORTED and retries.
 * The prod host uses a self-signed IP cert; the first handshake after a
 * debugger attach sometimes aborts (ERR_FAILED -2). did-fail-load already
 * shows a dialog for genuine failures, so here we just avoid the noisy
 * UnhandledPromiseRejectionWarning and give the load a couple of retries.
 *
 * @param {BrowserWindow} win
 * @param {string} url
 * @param {number} [attempts]
 */
async function loadUrlWithRetry(win, url, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    if (!win || win.isDestroyed()) return;
    try {
      await win.loadURL(url);
      return;
    } catch (err) {
      const msg = String(err?.message || err);
      // -3 ERR_ABORTED (superseded navigation) is benign; stop retrying.
      if (/ERR_ABORTED|\(-3\)/.test(msg)) return;
      const last = i === attempts - 1;
      console.warn(
        `[qchat-desktop] loadURL failed (${i + 1}/${attempts})${last ? "" : ", retrying"}:`,
        msg
      );
      if (last || !win || win.isDestroyed()) return;
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
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
 * @param {{
 *   webUrl: string,
 *   isDev: boolean,
 *   onDeepLink?: (url: string) => boolean,
 *   startHidden?: boolean,
 * }} opts
 */
function createMainWindow(opts) {
  const { webUrl, isDev, onDeepLink, startHidden = false } = opts;
  const saved = loadWindowState();
  const icon = iconOption();
  let appVersion = "0.1.0";
  try {
    appVersion = require(path.join(getDesktopRoot(), "package.json")).version;
  } catch {
    /* keep default */
  }

  let webOrigin = webUrl;
  try {
    webOrigin = new URL(webUrl).origin;
  } catch {
    webOrigin = String(webUrl).replace(/\/$/, "");
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
        `--qchat-platform-label=${encodeURIComponent(platformLabel())}`,
      ],
    },
  });

  // Apply PNG via nativeImage so Win11 taskbar is not a blank document icon.
  if (icon && process.platform === "win32") {
    try {
      mainWindow.setIcon(icon);
    } catch (err) {
      console.warn("[qchat-desktop] setIcon failed:", err?.message || err);
    }
  }

  if (detachWindowFocusBridge) {
    detachWindowFocusBridge();
    detachWindowFocusBridge = null;
  }
  detachWindowFocusBridge = attachWindowFocusBridge(
    mainWindow,
    (channel, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(channel, payload);
    },
    IPC.WINDOW_FOCUS_CHANGED
  );

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(APP_TITLE);
    }
  });

  /** @type {boolean} */
  let showOnReady = false;
  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setTitle(APP_TITLE);
    if (!mainWindow.isVisible()) mainWindow.show();
  };
  // SHELL-27: auto-reveal is skipped when starting hidden to tray.
  // Explicit focus (tray Show, deep link, second-instance) still shows.
  const revealMainWindow = () => {
    if (startHidden) return;
    showMainWindow();
  };

  mainWindow.once("ready-to-show", () => {
    mainWindow?.setTitle(APP_TITLE);
    if (showOnReady) revealMainWindow();
  });

  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
 // minimizeToTray: close button hides to tray instead of quitting.
  mainWindow.on("close", (event) => {
    saveWindowState();
    if (isAppQuitting()) return;
    const tray = getTray();
    if (!tray || tray.isDestroyed()) return;
    event.preventDefault();
    mainWindow.blur();
    mainWindow.hide();
  });

  attachNavigationGuards(mainWindow, webUrl, { onDeepLink });
  // SHELL-22: native edit/link/image/spellcheck menu; gated so web chat menus still work.
  attachContextMenu(mainWindow);

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      showMainWindow();
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
    // Prove the sandboxed preload exposed the bridge (needed for notifyMessage).
    mainWindow?.webContents
      .executeJavaScript(
        `({
          hasDesktop: Boolean(window.qchatDesktop?.isDesktop),
          hasNotify: typeof window.qchatDesktop?.notifyMessage,
          platformLabel: window.qchatDesktop?.platformLabel || null,
          path: location.pathname
        })`
      )
      .then((info) => {
        if (!info?.hasDesktop || info.hasNotify !== "function") {
          console.error(
            "[qchat-desktop] preload bridge missing after load — desktop notifications cannot run:",
            info
          );
        } else {
          console.log("[qchat-desktop] preload bridge ok:", info);
        }
      })
      .catch((err) => {
        console.warn(
          "[qchat-desktop] preload bridge probe failed:",
          err?.message || err
        );
      });

    // Don't force /login while a remembered session exists — auth gates handle expiry.
    if (hasSecureSession(webUrl)) return;
    const watchdog = `
      (function () {
        try {
          var path = location.pathname || "/";
          if (path !== "/" && path !== "") return;
          var text = (document.body && document.body.innerText || "").trim();
          if (text !== "Loading…" && text !== "Loading..." && text.indexOf("Starting Qchat") === -1) return;
          setTimeout(function () {
            var still = (document.body && document.body.innerText || "").trim();
            if (
              still === "Loading…" ||
              still === "Loading..." ||
              still.indexOf("Starting Qchat") !== -1
            ) {
              location.replace("/login");
            }
          }, 4000);
        } catch (e) {}
      })();
    `;
    mainWindow?.webContents.executeJavaScript(watchdog).catch(() => {});
  });

  void (async () => {
    // Refresh/validate vault before first paint so chat never mounts with a dead token
    // (that path shows Reconnecting then hard-navigates to /login).
    const fresh = hasSecureSession(webUrl)
      ? await ensureVaultSessionFresh(webUrl)
      : null;
    const remembered = Boolean(fresh?.accessToken);

    if (!mainWindow || mainWindow.isDestroyed()) return;

    attachSessionPersistence(mainWindow, webUrl, {
      deferShow: remembered || startHidden,
      reveal: revealMainWindow,
    });

    if (remembered) {
      await prepareEarlySessionBootstrap(mainWindow.webContents, webUrl, fresh);
      await loadUrlWithRetry(mainWindow, `${webOrigin}/`);
      return;
    }

    // No usable session — open login directly (same as web: splash only while checking).
    showOnReady = true;
    await loadUrlWithRetry(mainWindow, `${webOrigin}/login`);
    revealMainWindow();
  })();

  mainWindow.on("closed", () => {
    if (detachWindowFocusBridge) {
      detachWindowFocusBridge();
      detachWindowFocusBridge = null;
    }
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
