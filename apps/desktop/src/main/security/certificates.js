const { app } = require("electron");

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
 * Must be registered before any HTTPS navigation / net.fetch.
 * @param {string} webUrl
 */
function allowSelfSignedForWebHost(webUrl) {
  const allowed = allowedHostsFromWebUrl(webUrl);
  if (allowed.size === 0) return;

  app.on(
    "certificate-error",
    (event, _webContents, url, _error, _certificate, callback) => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (allowed.has(host)) {
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
}

module.exports = {
  allowSelfSignedForWebHost,
  allowedHostsFromWebUrl,
};
