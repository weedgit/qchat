const {
  app,
  BrowserWindow,
  shell,
  session,
  dialog,
  Menu,
  Notification,
  ipcMain,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { resolveWebUrl } = require("./config");

const WEB_URL = resolveWebUrl();
const isDev = process.env.QCHAT_DESKTOP_DEV === "1";
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_WINDOW = { width: 1280, height: 800 };
const APP_TITLE = "Qchat Desktop";
const ICON_PATH = path.join(__dirname, "assets", "icon.png");

/** Prefer /login so we don't land on the Suspense "Loading…" home page unauthenticated. */
function resolveStartUrl(base) {
  try {
    const u = new URL(base);
    if (!u.pathname || u.pathname === "/") {
      u.pathname = "/login";
    }
    return u.toString().replace(/\/$/, "") === `${u.origin}/login`
      ? `${u.origin}/login`
      : u.toString();
  } catch {
    return String(base).replace(/\/$/, "") + "/login";
  }
}

const START_URL = resolveStartUrl(WEB_URL);

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string | null} */
let pendingConversationId = null;

function iconOption() {
  return fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;
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

function focusMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function showAbout() {
  const opts = {
    type: "info",
    title: `About ${APP_TITLE}`,
    message: APP_TITLE,
    detail:
      `Version: ${app.getVersion()}\n` +
      `Platform: ${process.platform}\n` +
      `Web URL: ${WEB_URL}\n\n` +
      "Electron shell around the Qchat web client.\n\n" +
      "Open this dialog anytime from Help → About Qchat Desktop\n" +
      "(or press Ctrl+Shift+A).",
    buttons: ["OK"],
  };
  if (fs.existsSync(ICON_PATH)) opts.icon = ICON_PATH;
  dialog.showMessageBox(mainWindow || undefined, opts);
}

function sendConversationToRenderer(conversationId) {
  if (!conversationId) return;
  pendingConversationId = conversationId;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("qchat:open-conversation", conversationId);
  }
}

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  if (process.platform === "darwin") {
    template.push({
      label: APP_TITLE,
      submenu: [
        { label: `About ${APP_TITLE}`, click: showAbout },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [{ role: "quit", label: "Quit Qchat" }],
    });
  }

  template.push(
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: `About ${APP_TITLE}`,
          accelerator: "CmdOrCtrl+Shift+A",
          click: showAbout,
        },
      ],
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const saved = loadWindowState();
  const icon = iconOption();
  mainWindow = new BrowserWindow({
    width: saved.width || DEFAULT_WINDOW.width,
    height: saved.height || DEFAULT_WINDOW.height,
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Keep menu bar visible so Help → About is discoverable on Linux/Windows.
    autoHideMenuBar: false,
    title: APP_TITLE,
    ...(icon ? { icon } : {}),
    backgroundColor: "#0E1621",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Keep window title as "Qchat Desktop" (web page title would overwrite it).
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
  mainWindow.on("close", saveWindowState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {
      /* ignore invalid urls */
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new URL(WEB_URL);
      if (target.origin !== allowed.origin) {
        event.preventDefault();
        if (target.protocol === "http:" || target.protocol === "https:") {
          shell.openExternal(url);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      dialog.showErrorBox(
        "Qchat Desktop",
        `Could not load Qchat web UI.\n\n` +
          `URL: ${validatedURL || WEB_URL}\n` +
          `Error: ${errorDescription} (${errorCode})\n\n` +
          `Start apps/web (npm run dev) or set QCHAT_WEB_URL, e.g.\n` +
          `QCHAT_WEB_URL=http://135.181.224.36 npm start`
      );
    }
  );

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // If the home page is stuck on the static Suspense "Loading…" fallback, jump to login.
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

  mainWindow.loadURL(START_URL);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(() => {
    app.setName(APP_TITLE);
    if (process.platform === "linux" && fs.existsSync(ICON_PATH)) {
      // Linux window managers use this for the dock / taskbar entry.
      app.dock?.setIcon?.(ICON_PATH);
    }

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(["notifications", "media", "mediaKeySystem"].includes(permission));
    });

    session.defaultSession.on("will-download", async (event, item) => {
      const defaultPath = path.join(app.getPath("downloads"), item.getFilename());
      const result = await dialog.showSaveDialog(mainWindow || undefined, {
        title: "Save download",
        defaultPath,
      });
      if (result.canceled || !result.filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(result.filePath);
    });

    ipcMain.handle("qchat:desktop-notify", async (_event, payload) => {
      if (!Notification.isSupported()) return false;
      const title = String(payload?.title || APP_TITLE);
      const body = String(payload?.body || "");
      const conversationId = String(payload?.conversationId || "");
      const notification = new Notification({
        title,
        body,
        silent: Boolean(payload?.silent),
        ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
      });
      notification.on("click", () => {
        focusMainWindow();
        sendConversationToRenderer(conversationId);
      });
      notification.show();
      return true;
    });

    ipcMain.handle("qchat:fetch-captcha", async () => {
      const base = WEB_URL.replace(/\/$/, "");
      const url = `${base}/v1/auth/captcha`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        throw new Error(`captcha HTTP ${res.status}`);
      }
      const data = await res.json();
      return {
        captcha_id: String(data?.captcha_id ?? data?.id ?? ""),
        challenge: String(data?.challenge ?? ""),
      };
    });

    ipcMain.handle("qchat:show-about", async () => {
      showAbout();
      return true;
    });

    ipcMain.on("qchat:renderer-ready", () => {
      if (pendingConversationId && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("qchat:open-conversation", pendingConversationId);
      }
    });

    process.env.QCHAT_WEB_URL_RESOLVED = WEB_URL;
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
