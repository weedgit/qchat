const {
  getSecureSession,
  hasSecureSession,
  setSecureSession,
  clearSecureSession,
} = require("../secureStorage");

const ACCESS_KEY = "qchat.access_token";
const REFRESH_KEY = "qchat.refresh_token";
const REMEMBER_KEY = "qchat.remember";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Statements that write the vault session into page localStorage. */
function buildStorageAssignments(session) {
  return `
    var access = ${JSON.stringify(session.accessToken)};
    var refresh = ${JSON.stringify(session.refreshToken || "")};
    localStorage.setItem(${JSON.stringify(ACCESS_KEY)}, access);
    if (refresh) localStorage.setItem(${JSON.stringify(REFRESH_KEY)}, refresh);
    localStorage.setItem(${JSON.stringify(REMEMBER_KEY)}, "1");
    sessionStorage.removeItem(${JSON.stringify(ACCESS_KEY)});
    sessionStorage.removeItem(${JSON.stringify(REFRESH_KEY)});
  `;
}

function buildDocumentStartScript(session) {
  return `(function () { try { ${buildStorageAssignments(session)} } catch (e) {} })();`;
}

/**
 * Install a document-start script so tokens exist before React auth gates run.
 * @param {Electron.WebContents} wc
 * @param {string} webUrl
 * @param {{ accessToken: string, refreshToken?: string } | null} [session]
 */
async function prepareEarlySessionBootstrap(wc, webUrl, session = null) {
  const tokens = session || getSecureSession(webUrl);
  if (!tokens?.accessToken) return false;
  try {
    try {
      wc.debugger.attach("1.3");
    } catch (err) {
      if (!/already attached/i.test(String(err?.message || err))) {
        throw err;
      }
    }
    await wc.debugger.sendCommand("Page.enable");
    await wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
      source: buildDocumentStartScript(tokens),
    });
    return true;
  } catch (err) {
    console.warn(
      "[qchat-desktop] early session bootstrap failed:",
      err?.message || err
    );
    return false;
  }
}

function detachDebugger(wc) {
  try {
    if (wc.debugger.isAttached()) wc.debugger.detach();
  } catch {
    /* ignore */
  }
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {string} webUrl
 * @param {{ deferShow?: boolean, reveal?: () => void }} [opts]
 */
function attachSessionPersistence(win, webUrl, opts = {}) {
  const wc = win.webContents;
  const deferShow = Boolean(opts.deferShow);
  /** @type {number} */
  let suppressClearUntil = 0;
  let revealed = !deferShow;

  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    detachDebugger(wc);
    try {
      opts.reveal?.();
    } catch {
      /* ignore */
    }
  };

  const injectFromVault = async ({ allowRedirect = false } = {}) => {
    const session = getSecureSession(webUrl);
    if (!session?.accessToken) return false;
    suppressClearUntil = Date.now() + 8000;
    const redirect = allowRedirect
      ? `
          var path = location.pathname || "/";
          if (path === "/login" || path.indexOf("/login") === 0) {
            location.replace("/");
          }
        `
      : "";
    const script = `
      (function () {
        try {
          ${buildStorageAssignments(session)}
          ${redirect}
          return true;
        } catch (e) {
          return false;
        }
      })();
    `;
    try {
      await wc.executeJavaScript(script, true);
      return true;
    } catch (err) {
      console.warn(
        "[qchat-desktop] failed to inject secure session:",
        err?.message || err
      );
      return false;
    }
  };

  const readPageAuth = async () => {
    const script = `
      (function () {
        try {
          return {
            path: location.pathname || "/",
            access: localStorage.getItem(${JSON.stringify(ACCESS_KEY)})
              || sessionStorage.getItem(${JSON.stringify(ACCESS_KEY)}),
            refresh: localStorage.getItem(${JSON.stringify(REFRESH_KEY)})
              || sessionStorage.getItem(${JSON.stringify(REFRESH_KEY)}) || "",
            remember: localStorage.getItem(${JSON.stringify(REMEMBER_KEY)})
          };
        } catch (e) {
          return { path: "/", access: null, refresh: "", remember: null };
        }
      })();
    `;
    return wc.executeJavaScript(script, true);
  };

  const syncFromPage = async () => {
    if (wc.isDestroyed()) return;
    try {
      const snap = await readPageAuth();
      const access = String(snap?.access || "").trim();
      const refresh = String(snap?.refresh || "").trim();
      const remember = snap?.remember === "1";
      const path = String(snap?.path || "/");
      const onLogin = path === "/login" || path.startsWith("/login/");

      if (remember && access) {
        const prev = getSecureSession(webUrl);
        // Never wipe a stored refresh token with an empty scrape.
        setSecureSession(webUrl, {
          accessToken: access,
          refreshToken: refresh || prev?.refreshToken || "",
        });
        return;
      }

      // Page still wants remember but lost tokens — restore from vault (do not clear).
      if (remember && !access && hasSecureSession(webUrl)) {
        await injectFromVault({ allowRedirect: onLogin });
        return;
      }

      // Explicit sign-out / session-only: remember flag cleared.
      if (!access && snap?.remember === "0") {
        clearSecureSession(webUrl);
        return;
      }
      if (
        !access &&
        onLogin &&
        snap?.remember !== "1" &&
        Date.now() > suppressClearUntil
      ) {
        clearSecureSession(webUrl);
      }
    } catch (err) {
      console.warn(
        "[qchat-desktop] failed to sync session from page:",
        err?.message || err
      );
    }
  };

  const settleRememberedSession = async () => {
    if (!deferShow || revealed || wc.isDestroyed()) return;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !wc.isDestroyed() && !revealed) {
      await injectFromVault({ allowRedirect: false });
      let snap;
      try {
        snap = await readPageAuth();
      } catch {
        await sleep(50);
        continue;
      }
      const path = String(snap?.path || "/");
      const access = String(snap?.access || "").trim();
      const onLogin = path === "/login" || path.startsWith("/login/");

      // Stay hidden on splash ("Starting Qchat") / login bounce — match web UX.
      const onSplash =
        !onLogin &&
        (path === "/" || path === "") &&
        !access;

      if (access && !onLogin && !onSplash) {
        await sleep(80);
        reveal();
        return;
      }
      if (access && (path === "/" || path === "")) {
        // Tokens ready on home — reveal even while chat is still connecting.
        await sleep(80);
        reveal();
        return;
      }
      if (onLogin && hasSecureSession(webUrl)) {
        await injectFromVault({ allowRedirect: true });
        await sleep(150);
        continue;
      }
      await sleep(50);
    }
    reveal();
  };

  wc.on("dom-ready", () => {
    void injectFromVault({ allowRedirect: false });
  });

  wc.on("did-finish-load", () => {
    void injectFromVault({ allowRedirect: false });
    void syncFromPage();
    if (deferShow) void settleRememberedSession();
    else detachDebugger(wc);
  });

  wc.on("did-navigate-in-page", () => {
    void syncFromPage();
  });

  win.on("close", () => {
    void syncFromPage();
  });

  if (deferShow) {
    setTimeout(() => reveal(), 12000);
  }
}

module.exports = {
  attachSessionPersistence,
  prepareEarlySessionBootstrap,
};
