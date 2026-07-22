const { app, session } = require("electron");

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

/**
 * Accept TLS errors only for the configured Qchat web host.
 * Registers both:
 * - app `certificate-error` (navigation / older path)
 * - session `setCertificateVerifyProc` (Electron 39+ / Chromium; more reliable)
 *
 * Call once with the resolved web URL; verify-proc attaches on `ready` if needed.
 * @param {string} webUrl
 */
function allowSelfSignedForWebHost(webUrl) {
  const allowed = allowedHostsFromWebUrl(webUrl);
  if (allowed.size === 0) return;

  const hostAllowed = (hostname) =>
    Boolean(hostname) && allowed.has(String(hostname).toLowerCase());

  app.on(
    "certificate-error",
    (event, _webContents, url, _error, _certificate, callback) => {
      try {
        if (hostAllowed(new URL(url).hostname)) {
          event.preventDefault();
          callback(true);
          return;
        }
      } catch {
        /* fall through */
      }
      callback(false);
    }
  );

  const attachVerifyProc = () => {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      if (hostAllowed(request.hostname)) {
        callback(0); // OK
        return;
      }
      callback(-3); // Chromium default
    });
  };

  if (app.isReady()) attachVerifyProc();
  else app.whenReady().then(attachVerifyProc);
}

module.exports = {
  allowSelfSignedForWebHost,
  allowedHostsFromWebUrl,
};
