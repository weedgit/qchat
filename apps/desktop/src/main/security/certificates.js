const { app, session, dialog } = require("electron");
const { getCertificateStore } = require("./certificateStore");

/**
 * Hosts we intentionally trust when the server uses a self-signed / private CA
 * cert (typical for IP-based nginx until a public CA is configured).
 * @param {string} webUrl
 * @returns {Set<string>}
 */
function allowedHostsFromWebUrl(webUrl) {
  const hosts = new Set();
  try {
    const host = new URL(webUrl).hostname;
    if (host) hosts.add(host.toLowerCase());
  } catch {
    /* ignore invalid webUrl */
  }
  return hosts;
}

/** @type {Map<string, (trusted: boolean) => void>} */
const pendingCertCallbacks = new Map();

/**
 * Accept TLS for the configured Qchat web host, and for other origins show a
 * Mattermost-style trust / deny dialog (SHELL-30). Persisted decisions live in
 * userData/certificate.json.
 *
 * @param {string | { webUrl: string, getMainWindow?: () => Electron.BrowserWindow | null }} webUrlOrOpts
 * @param {() => Electron.BrowserWindow | null} [maybeGetMainWindow]
 */
function allowSelfSignedForWebHost(webUrlOrOpts, maybeGetMainWindow) {
  /** @type {string} */
  let webUrl;
  /** @type {(() => Electron.BrowserWindow | null) | undefined} */
  let getMainWindow;

  if (webUrlOrOpts && typeof webUrlOrOpts === "object") {
    webUrl = String(webUrlOrOpts.webUrl || "");
    getMainWindow = webUrlOrOpts.getMainWindow;
  } else {
    webUrl = String(webUrlOrOpts || "");
    getMainWindow = maybeGetMainWindow;
  }

  const allowed = allowedHostsFromWebUrl(webUrl);
  const hostAllowed = (hostname) =>
    Boolean(hostname) && allowed.has(String(hostname).toLowerCase());

  const resolveParent = () => {
    try {
      return (typeof getMainWindow === "function" && getMainWindow()) || undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * @param {Electron.Event} event
   * @param {Electron.WebContents} webContents
   * @param {string} url
   * @param {string} error
   * @param {Electron.Certificate} certificate
   * @param {(isTrusted: boolean) => void} callback
   */
  const onCertificateError = async (
    event,
    webContents,
    url,
    error,
    certificate,
    callback
  ) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      callback(false);
      return;
    }

    // Configured Qchat web host: silent trust (existing production behavior).
    if (hostAllowed(parsed.hostname)) {
      event.preventDefault();
      callback(true);
      return;
    }

    const store = getCertificateStore();
    if (store.isExplicitlyUntrusted(parsed)) {
      event.preventDefault();
      console.warn(
        "[qchat-desktop] ignoring previously untrusted certificate for",
        parsed.origin
      );
      callback(false);
      return;
    }
    if (store.isTrusted(parsed, certificate)) {
      event.preventDefault();
      callback(true);
      return;
    }

    event.preventDefault();

    const errorID = `${parsed.origin}:${error}`;
    if (pendingCertCallbacks.has(errorID)) {
      // Collapse concurrent prompts for the same failure into one dialog.
      pendingCertCallbacks.set(errorID, callback);
      return;
    }
    pendingCertCallbacks.set(errorID, callback);

    const extraDetail = store.isExisting(parsed)
      ? "Certificate is different from previous one.\n\n"
      : "";
    const detail = `${extraDetail}origin: ${parsed.origin}\nError: ${error}`;

    try {
      let result = await dialog.showMessageBox(resolveParent(), {
        title: "Certificate Error",
        message:
          "There is a problem with the security certificate for this server. Contact your admin if you did not expect this.",
        type: "warning",
        detail,
        buttons: ["More Details", "Cancel Connection"],
        cancelId: 1,
        defaultId: 1,
      });

      if (result.response === 0) {
        result = await dialog.showMessageBox(resolveParent(), {
          title: "Certificate Not Trusted",
          message: `Certificate from "${certificate.issuerName || "unknown"}" is not trusted.`,
          detail: extraDetail || undefined,
          type: "warning",
          buttons: ["Trust Insecure Certificate", "Cancel Connection"],
          cancelId: 1,
          defaultId: 1,
          checkboxChecked: false,
          checkboxLabel: "Don't ask again",
        });
      } else {
        result = { response: 1, checkboxChecked: false };
      }

      const finish = pendingCertCallbacks.get(errorID) || callback;
      pendingCertCallbacks.delete(errorID);

      if (result.response === 0) {
        store.add(parsed, certificate, false);
        store.save();
        finish(true);
        try {
          webContents.loadURL(url);
        } catch {
          /* ignore reload failure */
        }
      } else {
        if (result.checkboxChecked) {
          store.add(parsed, certificate, true);
          store.save();
        }
        finish(false);
      }
    } catch (err) {
      console.warn(
        "[qchat-desktop] certificate dialog failed:",
        err?.message || err
      );
      const finish = pendingCertCallbacks.get(errorID) || callback;
      pendingCertCallbacks.delete(errorID);
      finish(false);
    }
  };

  app.on("certificate-error", onCertificateError);

  const attachVerifyProc = () => {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      const hostname = request.hostname;
      if (hostAllowed(hostname)) {
        callback(0); // OK — configured web host
        return;
      }

      try {
        const parsed = new URL(`https://${hostname}/`);
        const store = getCertificateStore();
        if (store.isExplicitlyUntrusted(parsed)) {
          callback(-2); // failed
          return;
        }
        if (request.certificate && store.isTrusted(parsed, request.certificate)) {
          callback(0);
          return;
        }
      } catch {
        /* fall through */
      }

      callback(-3); // Chromium default verification
    });
  };

  if (app.isReady()) attachVerifyProc();
  else app.whenReady().then(attachVerifyProc);
}

module.exports = {
  allowSelfSignedForWebHost,
  allowedHostsFromWebUrl,
};
