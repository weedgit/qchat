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
  joinWebPath,
  resolveWebBase,
  isLoginPath,
  isAppHomePath,
} = require("../app/configuration/webUrl");
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
 * Remote Next.js SSR paints "Starting XinChat" before CSS/JS arrive. On a slow or
 * flaky path to the VPS, Chromium can sit on that unstyled splash forever.
 * Detect and hard-reload once; if still stuck, surface an error dialog.
 *
 * @param {Electron.BrowserWindow} win
 * @param {string} webBase
 */
async function ensureRemoteUiHydrated(win, webBase) {
  if (!win || win.isDestroyed()) return;
  const probe = `
    (async function () {
      var deadline = Date.now() + 25000;
      var started = Date.now();
      while (Date.now() < deadline) {
        if (document.querySelector(".auth-wrap, .auth-card, input[type=password], .chat-shell, [data-qchat-ready]")) {
          return { ok: true, reason: "ui-ready" };
        }
        var splash = document.querySelector(".boot-splash");
        if (splash && Date.now() - started > 5000) {
          var display = window.getComputedStyle(splash).display;
          var styled = display === "flex" || display === "grid";
          if (!styled && document.styleSheets.length === 0) {
            return { ok: false, reason: "no-css", sheets: 0 };
          }
        }
        await new Promise(function (r) { setTimeout(r, 400); });
      }
      var text = ((document.body && document.body.innerText) || "").replace(/\\s+/g, " ").trim();
      if (/Starting XinChat|Starting XinChat/i.test(text) && !document.querySelector("input, .auth-wrap")) {
        return {
          ok: false,
          reason: "stuck-splash",
          sheets: document.styleSheets.length,
          text: text.slice(0, 80)
        };
      }
      return { ok: true, reason: "assumed-ok" };
    })()
  `;

  let result = null;
  try {
    result = await win.webContents.executeJavaScript(probe);
  } catch (err) {
    console.warn(
      "[xinchat-desktop] hydration probe failed:",
      err?.message || err
    );
    return;
  }
  if (!result || result.ok) {
    if (result?.reason) {
      console.log("[xinchat-desktop] remote UI:", result.reason);
    }
    return;
  }

  console.warn(
    "[xinchat-desktop] remote UI stuck (",
    result.reason,
    ") — reloading once"
  );
  try {
    await win.webContents.reloadIgnoringCache();
    await new Promise((r) => setTimeout(r, 1500));
    result = await win.webContents.executeJavaScript(probe);
  } catch (err) {
    console.warn(
      "[xinchat-desktop] hydration reload failed:",
      err?.message || err
    );
    result = { ok: false, reason: "reload-failed" };
  }

  if (result && result.ok) {
    console.log("[xinchat-desktop] remote UI recovered:", result.reason);
    return;
  }

  dialog.showErrorBox(
    "XinChat Desktop",
    `Login UI did not load (web assets stalled).\n\n` +
      `Server: ${webBase}\n` +
      `Detail: ${result?.reason || "unknown"}\n\n` +
      `The HTML shell loaded but CSS/JS did not finish. Check network reachability ` +
      `to the server, disable VPN/proxy if needed, then reopen the app.\n\n` +
      `Dev workaround: run local web + desktop:\n` +
      `  cd apps/web && npm run dev\n` +
      `  cd apps/desktop && npm run start:local`
  );
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
        `[xinchat-desktop] loadURL failed (${i + 1}/${attempts})${last ? "" : ", retrying"}:`,
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
  // After close-to-tray we call app.hide() on macOS; reverse that and steal
  // focus so a toast / tray click reliably brings the chat forward.
  if (process.platform === "darwin") {
    try {
      app.show();
    } catch {
      /* ignore */
    }
    try {
      if (typeof app.focus === "function") {
        app.focus({ steal: true });
      }
    } catch {
      /* ignore */
    }
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  try {
    mainWindow.moveTop();
  } catch {
    /* ignore */
  }
  mainWindow.show();
  mainWindow.focus();
  try {
    if (typeof mainWindow.focusOnWebView === "function") {
      mainWindow.focusOnWebView();
    } else {
      mainWindow.webContents?.focus?.();
    }
  } catch {
    /* ignore */
  }
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

  let webBase = resolveWebBase(webUrl);

  mainWindow = new BrowserWindow({
    width: saved.width || DEFAULT_WINDOW.width,
    height: saved.height || DEFAULT_WINDOW.height,
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    // Telegram-like: allow shrinking into single-pane list/chat layout (~768px).
    minWidth: 420,
    minHeight: 480,
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
      console.warn("[xinchat-desktop] setIcon failed:", err?.message || err);
    }
  }

  // Keep WS / timers alive while hidden to tray so message toasts still fire.
  try {
    mainWindow.webContents.setBackgroundThrottling(false);
  } catch {
    /* older Electron */
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

  const splashPath = path.join(getDesktopRoot(), "assets", "splash.html");
  const chatLayoutCssPath = path.join(
    getDesktopRoot(),
    "assets",
    "chat-layout-override.css"
  );

  /** Force full-pane chat chrome (overrides remote ~752px column if still deployed). */
  async function injectChatLayoutOverride() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const loadedUrl = mainWindow.webContents.getURL() || "";
    if (!/^https?:/i.test(loadedUrl)) return;
    try {
      const css = fs.readFileSync(chatLayoutCssPath, "utf8");
      await mainWindow.webContents.insertCSS(css);
    } catch (err) {
      console.warn(
        "[xinchat-desktop] chat layout CSS inject failed:",
        err?.message || err
      );
    }
  }

  /** Show local "Starting XinChat" splash immediately so startup never looks frozen. */
  async function showStartupSplash() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (fs.existsSync(splashPath)) {
        await mainWindow.loadFile(splashPath);
      }
    } catch (err) {
      console.warn(
        "[xinchat-desktop] splash load failed:",
        err?.message || err
      );
    }
    revealMainWindow();
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.setTitle(APP_TITLE);
    // Splash (or first paint) should already have asked to reveal; keep as fallback.
    if (!startHidden) revealMainWindow();
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
    // macOS suppresses banners for the frontmost app. Resign active so
    // Notification Center can show toasts while we sit in the tray.
    if (process.platform === "darwin") {
      try {
        app.hide();
      } catch {
        /* ignore */
      }
    }
  });

  // Same: after minimize, resign active on macOS so OS toasts can banner.
  mainWindow.on("minimize", () => {
    if (process.platform !== "darwin") return;
    try {
      app.hide();
    } catch {
      /* ignore */
    }
  });

  attachNavigationGuards(mainWindow, webUrl, { onDeepLink });
  // SHELL-22: native edit/link/image/spellcheck menu; gated so web chat menus still work.
  attachContextMenu(mainWindow);

  // Log failed CSS/JS — common when the VPS path stalls and login never hydrates.
  try {
    const ses = mainWindow.webContents.session;
    ses.webRequest.onErrorOccurred((details) => {
      if (!details || details.resourceType === "mainFrame") return;
      if (
        details.resourceType === "stylesheet" ||
        details.resourceType === "script" ||
        details.resourceType === "xhr"
      ) {
        console.warn(
          "[xinchat-desktop] resource failed:",
          details.resourceType,
          details.error,
          details.url
        );
      }
    });
  } catch (err) {
    console.warn(
      "[xinchat-desktop] webRequest hook failed:",
      err?.message || err
    );
  }

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      showMainWindow();
      dialog.showErrorBox(
        "XinChat Desktop",
        `Could not load XinChat web UI.\n\n` +
          `URL: ${validatedURL || webUrl}\n` +
          `Error: ${errorDescription} (${errorCode})\n\n` +
          `Start apps/xin-web (npm run dev) or set XINCHAT_WEB_URL in apps/xin-desktop/.env`
      );
    }
  );

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on("dom-ready", () => {
    void injectChatLayoutOverride();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const loadedUrl = mainWindow?.webContents.getURL() || "";
    const isAppPage = /^https?:/i.test(loadedUrl);
    // Local splash is file:// — skip bridge probe / login watchdog there.
    if (isAppPage) {
      void injectChatLayoutOverride();
      // Prove the sandboxed preload exposed the bridge (needed for notifyMessage).
      mainWindow?.webContents
        .executeJavaScript(
          `({
            hasDesktop: Boolean(window.xinchatDesktop?.isDesktop),
            hasNotify: typeof window.xinchatDesktop?.notifyMessage,
            platformLabel: window.xinchatDesktop?.platformLabel || null,
            path: location.pathname
          })`
        )
        .then((info) => {
          if (!info?.hasDesktop || info.hasNotify !== "function") {
            console.error(
              "[xinchat-desktop] preload bridge missing after load — desktop notifications cannot run:",
              info
            );
          } else {
            console.log("[xinchat-desktop] preload bridge ok:", info);
          }
        })
        .catch((err) => {
          console.warn(
            "[xinchat-desktop] preload bridge probe failed:",
            err?.message || err
          );
        });
    }

    // Don't force /login while a remembered session exists — auth gates handle expiry.
    if (!isAppPage || hasSecureSession(webUrl)) return;
    const homePath =
      new URL(joinWebPath(webUrl, "/")).pathname.replace(/\/$/, "") || "/";
    const loginUrl = joinWebPath(webUrl, "/login");
    const watchdog = `
      (function () {
        try {
          var path = (location.pathname || "/").replace(/\\/$/, "") || "/";
          var home = ${JSON.stringify(homePath)};
          if (path !== home) return;
          var text = (document.body && document.body.innerText || "").trim();
          if (text !== "Loading…" && text !== "Loading..." && text.indexOf("Starting XinChat") === -1) return;
          setTimeout(function () {
            var still = (document.body && document.body.innerText || "").trim();
            if (
              still === "Loading…" ||
              still === "Loading..." ||
              still.indexOf("Starting XinChat") !== -1
            ) {
              location.replace(${JSON.stringify(loginUrl)});
            }
          }, 4000);
        } catch (e) {}
      })();
    `;
    mainWindow?.webContents.executeJavaScript(watchdog).catch(() => {});
  });

  void (async () => {
    // Paint waiting UI first (matches web LoadingSplash) before vault / network work.
    if (!startHidden) {
      await showStartupSplash();
    }

    // Refresh/validate vault before chat mounts with a dead token
    // (that path shows Reconnecting then hard-navigates to /login).
    const fresh = hasSecureSession(webUrl)
      ? await ensureVaultSessionFresh(webUrl)
      : null;
    const remembered = Boolean(fresh?.accessToken);

    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Only stay hidden when launched to tray. Remembered-session boot keeps the
    // splash visible instead of a black empty shell.
    attachSessionPersistence(mainWindow, webUrl, {
      deferShow: startHidden,
      reveal: revealMainWindow,
    });

    if (remembered) {
      await prepareEarlySessionBootstrap(mainWindow.webContents, webUrl, fresh);
      await loadUrlWithRetry(mainWindow, joinWebPath(webUrl, "/"));
      revealMainWindow();
      void ensureRemoteUiHydrated(mainWindow, webBase);
      return;
    }

    // No usable session — open login (splash already covered the wait).
    await loadUrlWithRetry(mainWindow, joinWebPath(webUrl, "/login"));
    revealMainWindow();
    void ensureRemoteUiHydrated(mainWindow, webBase);
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
