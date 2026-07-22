const {
  getSecureSession,
  setSecureSession,
  clearSecureSession,
} = require("../secureStorage");

const ACCESS_KEY = "qchat.access_token";
const REFRESH_KEY = "qchat.refresh_token";
const REMEMBER_KEY = "qchat.remember";

/**
 * Keep Electron safeStorage in sync with the web client's token keys.
 * Required for start:server / packaged apps that load a remote web build
 * which may not call qchatDesktop.setSecureSession yet.
 *
 * @param {Electron.BrowserWindow} win
 * @param {string} webUrl
 */
function attachSessionPersistence(win, webUrl) {
  const wc = win.webContents;
  /** @type {number} */
  let suppressClearUntil = 0;

  const injectFromVault = async () => {
    const session = getSecureSession(webUrl);
    if (!session?.accessToken) return;
    suppressClearUntil = Date.now() + 4000;
    const script = `
      (function () {
        try {
          var access = ${JSON.stringify(session.accessToken)};
          var refresh = ${JSON.stringify(session.refreshToken || "")};
          localStorage.setItem(${JSON.stringify(ACCESS_KEY)}, access);
          if (refresh) localStorage.setItem(${JSON.stringify(REFRESH_KEY)}, refresh);
          localStorage.setItem(${JSON.stringify(REMEMBER_KEY)}, "1");
          sessionStorage.removeItem(${JSON.stringify(ACCESS_KEY)});
          sessionStorage.removeItem(${JSON.stringify(REFRESH_KEY)});
          var path = location.pathname || "/";
          if (path === "/login" || path.indexOf("/login") === 0) {
            location.replace("/");
          }
        } catch (e) {}
      })();
    `;
    try {
      await wc.executeJavaScript(script, true);
    } catch (err) {
      console.warn(
        "[qchat-desktop] failed to inject secure session:",
        err?.message || err
      );
    }
  };

  const syncFromPage = async () => {
    if (wc.isDestroyed()) return;
    const script = `
      (function () {
        try {
          return {
            access: localStorage.getItem(${JSON.stringify(ACCESS_KEY)})
              || sessionStorage.getItem(${JSON.stringify(ACCESS_KEY)}),
            refresh: localStorage.getItem(${JSON.stringify(REFRESH_KEY)})
              || sessionStorage.getItem(${JSON.stringify(REFRESH_KEY)}) || "",
            remember: localStorage.getItem(${JSON.stringify(REMEMBER_KEY)})
          };
        } catch (e) {
          return { access: null, refresh: "", remember: null };
        }
      })();
    `;
    try {
      const snap = await wc.executeJavaScript(script, true);
      const access = String(snap?.access || "").trim();
      const remember = snap?.remember === "1";
      if (remember && access) {
        setSecureSession(webUrl, {
          accessToken: access,
          refreshToken: String(snap?.refresh || ""),
        });
        return;
      }
      // Logged out (or never signed in): drop vault so next launch shows sign-in.
      // Skip briefly after inject so an empty first paint cannot wipe a good session.
      if (!access && Date.now() > suppressClearUntil) {
        clearSecureSession(webUrl);
      }
    } catch (err) {
      console.warn(
        "[qchat-desktop] failed to sync session from page:",
        err?.message || err
      );
    }
  };

  wc.on("dom-ready", () => {
    void injectFromVault();
  });

  wc.on("did-finish-load", () => {
    void injectFromVault();
    void syncFromPage();
  });

  wc.on("did-navigate-in-page", () => {
    void syncFromPage();
  });

  win.on("close", () => {
    void syncFromPage();
  });
}

module.exports = { attachSessionPersistence };
