const { app, dialog } = require("electron");
const { APP_TITLE } = require("../../shared/constants");
const { resolveUpdateUrl } = require("../app/configuration/updateUrl");

/** @type {{ checkForUpdates: (opts?: { manual?: boolean }) => Promise<{ ok: boolean, reason?: string }> }} */
let api = {
  checkForUpdates: async () => ({ ok: false, reason: "not-registered" }),
};

/**
 * PACK-06 — electron-updater scaffold.
 * Runs only when packaged and an update feed URL is configured.
 * Does nothing in unpackaged / missing-URL cases so existing flows stay safe.
 *
 * @param {object} deps
 * @param {() => Electron.BrowserWindow | null} deps.getMainWindow
 */
function registerAutoUpdater(deps) {
  const getMainWindow = deps?.getMainWindow || (() => null);

  if (!app.isPackaged) {
    api = {
      checkForUpdates: async ({ manual } = {}) => {
        if (manual) {
          await dialog.showMessageBox(getMainWindow() || undefined, {
            type: "info",
            title: APP_TITLE,
            message: "Updates are only checked in packaged builds.",
            detail: `You are running an unpackaged development build (${app.getVersion()}).`,
            buttons: ["OK"],
          });
        }
        return { ok: false, reason: "unpackaged" };
      },
    };
    return api;
  }

  const updateUrl = resolveUpdateUrl();
  if (!updateUrl) {
    api = {
      checkForUpdates: async ({ manual } = {}) => {
        if (manual) {
          await dialog.showMessageBox(getMainWindow() || undefined, {
            type: "info",
            title: APP_TITLE,
            message: "Auto-update is not configured.",
            detail:
              "Set updateUrl in production.json or userData/config.json, or QCHAT_UPDATE_URL, then rebuild.",
            buttons: ["OK"],
          });
        }
        return { ok: false, reason: "no-url" };
      },
    };
    console.log(
      "[qchat-desktop] auto-update skipped (no updateUrl / QCHAT_UPDATE_URL)"
    );
    return api;
  }

  /** @type {import('electron-updater').AppUpdater | null} */
  let autoUpdater = null;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.warn(
      "[qchat-desktop] electron-updater unavailable:",
      err?.message || err
    );
    api = {
      checkForUpdates: async () => ({ ok: false, reason: "module-missing" }),
    };
    return api;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  try {
    autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
  } catch (err) {
    console.warn(
      "[qchat-desktop] setFeedURL failed:",
      err?.message || err
    );
  }

  autoUpdater.on("error", (err) => {
    console.warn(
      "[qchat-desktop] auto-update error:",
      err?.message || err
    );
  });

  autoUpdater.on("update-available", async (info) => {
    const version = info?.version || "a newer version";
    const result = await dialog.showMessageBox(getMainWindow() || undefined, {
      type: "info",
      title: APP_TITLE,
      message: `Update available (${version})`,
      detail: "Download and install this update now?",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        console.warn(
          "[qchat-desktop] downloadUpdate failed:",
          err?.message || err
        );
      }
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const version = info?.version || "the new version";
    const result = await dialog.showMessageBox(getMainWindow() || undefined, {
      type: "info",
      title: APP_TITLE,
      message: "Update ready to install",
      detail: `Version ${version} was downloaded. Restart Qchat Desktop to apply it.`,
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  /**
   * @param {{ manual?: boolean }} [opts]
   */
  async function checkForUpdates({ manual = false } = {}) {
    try {
      if (manual) {
        const onNotAvailable = async () => {
          await dialog.showMessageBox(getMainWindow() || undefined, {
            type: "info",
            title: APP_TITLE,
            message: "You're up to date",
            detail: `You are using the latest version of ${APP_TITLE} (${app.getVersion()}).`,
            buttons: ["OK"],
          });
        };
        autoUpdater.once("update-not-available", onNotAvailable);
        autoUpdater.once("update-available", () => {
          try {
            autoUpdater.removeListener("update-not-available", onNotAvailable);
          } catch {
            /* ignore */
          }
        });
      }
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      console.warn(
        "[qchat-desktop] checkForUpdates failed:",
        err?.message || err
      );
      if (manual) {
        await dialog.showMessageBox(getMainWindow() || undefined, {
          type: "warning",
          title: APP_TITLE,
          message: "Could not check for updates",
          detail: String(err?.message || err || "Unknown error"),
          buttons: ["OK"],
        });
      }
      return { ok: false, reason: "check-failed" };
    }
  }

  api = { checkForUpdates };

  // Quiet background check shortly after launch (no dialog if already current).
  setTimeout(() => {
    checkForUpdates({ manual: false }).catch(() => {});
  }, 15_000);

  console.log(`[qchat-desktop] auto-update feed: ${updateUrl}`);
  return api;
}

function getAutoUpdateApi() {
  return api;
}

module.exports = {
  registerAutoUpdater,
  getAutoUpdateApi,
};
