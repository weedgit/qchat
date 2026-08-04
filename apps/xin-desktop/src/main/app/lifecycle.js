const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const {
  APP_TITLE,
  APP_ID,
  TOAST_ACTIVATOR_CLSID,
} = require("../../shared/constants");
const { getIconPath } = require("../app/configuration/paths");
const { resolveWebUrl } = require("../app/configuration/webUrl");
const { buildAppMenu } = require("../native/menu");
const {
  createSystemTray,
  refreshTrayMenu,
  registerTrayQuitHook,
} = require("../native/tray");
const { applyStoredAutostart } = require("../native/autostart");
const { shouldStartHidden } = require("../native/hideOnStart");
const { registerPermissionHandler } = require("../security/permissions");
const { registerScreenshareHandler } = require("../security/screenshare");
const { allowLocalNetworkForCalls } = require("../security/localNetwork");
const { allowSelfSignedForWebHost } = require("../security/certificates");
const { registerThemeSync } = require("../native/theme");
const { startIdleMonitor } = require("../native/idleMonitor");
const { registerDownloadHandler } = require("../services/downloads");
const { registerAutoUpdater } = require("../services/autoUpdate");
const { registerIpcHandlers } = require("../ipc/handlers");
const {
  getMainWindow,
  focusMainWindow,
  createMainWindow,
  sendConversationToRenderer,
  flushPendingConversation,
} = require("../windows/mainWindow");
const {
  registerProtocolClient,
  getDeepLinkFromArgv,
} = require("./protocol");
const { createDeepLinkHandler } = require("./deepLink");
const { registerWindowsNotifications } = require("../native/windowsNotifications");

function startApp() {
  // Windows toast identity is also set in index.js (must be before ready).
  if (process.platform === "win32") {
    try {
      app.setName(APP_TITLE);
    } catch {
      /* ignore */
    }
    app.setAppUserModelId(APP_ID);
    app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
  }

  // Before ready: unblock LiveKit ws://LAN from localhost web UI (Chromium PNA/LNA).
  allowLocalNetworkForCalls();
  // SHELL-31: nativeTheme follows system until the web client sets an explicit source.
  registerThemeSync({ getMainWindow });

  const webUrl = resolveWebUrl();
  // Production nginx redirects HTTP→HTTPS with a self-signed IP cert.
  // Other origins get SHELL-30 trust/deny UI (persisted in userData/certificate.json).
  allowSelfSignedForWebHost({ webUrl, getMainWindow });
  const isDev =
    process.env.QCHAT_DESKTOP_DEV === "1" || process.argv.includes("--dev");
  const iconPath = getIconPath();

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  /** @type {(raw: string) => boolean} */
  let openDeepLink = () => false;
  const focus = () =>
    focusMainWindow(() =>
      createMainWindow({
        webUrl,
        isDev,
        onDeepLink: openDeepLink,
        startHidden: false,
      })
    );
  openDeepLink = createDeepLinkHandler({
    focusMainWindow: focus,
    sendConversationToRenderer,
  });

  // SHELL-28: claim qchat:// (packaged + unpackaged).
  registerProtocolClient();

  // Cold-start / second-instance argv (Windows + Linux).
  let pendingDeepLink = getDeepLinkFromArgv(process.argv);
  // SHELL-27: preference / --hidden / wasOpenedAsHidden (Mattermost-style).
  const startHidden = shouldStartHidden(process.argv) && !pendingDeepLink;

  // macOS: links arrive via open-url (may fire before ready).
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) openDeepLink(url);
    else pendingDeepLink = url;
  });

  app.on("second-instance", (_event, argv) => {
    focus();
    const link = getDeepLinkFromArgv(argv);
    if (link) openDeepLink(link);
  });

  registerTrayQuitHook();

  app.whenReady().then(() => {
    app.setName(APP_TITLE);
    // Start Menu .lnk + one-time prime toast so Windows lists Qchat under Notifications.
    registerWindowsNotifications();
    if (process.platform === "linux" && fs.existsSync(iconPath)) {
      app.dock?.setIcon?.(iconPath);
    }

    registerPermissionHandler();
    registerScreenshareHandler();
    registerDownloadHandler(getMainWindow);

    registerIpcHandlers({
      webUrl,
      getMainWindow,
      focusMainWindow: focus,
      sendConversationToRenderer,
      flushPendingConversation,
    });

    // AUTH-04: system idle → renderer (web bridges to away/online).
    startIdleMonitor({ getMainWindow });
    // PACK-06: electron-updater (packaged + updateUrl only).
    registerAutoUpdater({ getMainWindow });

    process.env.QCHAT_WEB_URL_RESOLVED = webUrl;

    const rebuildChrome = () => {
      buildAppMenu({
        webUrl,
        isDev,
        getMainWindow,
        onAutostartChanged: () => refreshTrayMenu(trayDeps),
        onHideOnStartChanged: () => refreshTrayMenu(trayDeps),
      });
      refreshTrayMenu(trayDeps);
    };

    const trayDeps = {
      focusMainWindow: focus,
      onAutostartChanged: rebuildChrome,
      onHideOnStartChanged: rebuildChrome,
    };

    buildAppMenu({
      webUrl,
      isDev,
      getMainWindow,
      onAutostartChanged: () => refreshTrayMenu(trayDeps),
      onHideOnStartChanged: () => refreshTrayMenu(trayDeps),
    });
    createMainWindow({
      webUrl,
      isDev,
      onDeepLink: openDeepLink,
      startHidden,
    });
    // TrayIcon.init: icon in notification area; click focuses main window.
    const tray = createSystemTray(trayDeps);
    // AutoLauncher: apply saved open-at-login preference when packaged.
    applyStoredAutostart();

    // Cannot stay hidden without a tray affordance to show the window again.
    if (startHidden && !tray) {
      focus();
    }

    if (pendingDeepLink) {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      // Let the window finish bootstrapping session / preload before opening chat.
      setTimeout(() => openDeepLink(link), 300);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({
          webUrl,
          isDev,
          onDeepLink: openDeepLink,
          startHidden: false,
        });
      } else {
        focus();
      }
    });
  });

  app.on("window-all-closed", () => {
    // With close-to-tray the window is hidden, not closed — this rarely fires.
    // Only quit when the window was actually destroyed (no tray path).
    if (process.platform !== "darwin") app.quit();
  });
}

module.exports = { startApp };
