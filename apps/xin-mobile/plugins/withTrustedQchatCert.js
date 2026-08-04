/**
 * Trust the Qchat nginx self-signed cert (deploy/certs/qchat.crt) in Android
 * network security config so HTTPS fetch works outside Expo Go.
 *
 * Dev / preview only. Production profiles must omit this plugin
 * (see app.config.js + QCHAT_TRUST_CERT=0).
 *
 * Mirror: Android network_security_config custom trust-anchors.
 */
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const CERT_SRC = "certs/qchat.crt";
const RAW_NAME = "qchat_cert";
const API_HOST = process.env.QCHAT_TRUST_HOST || "135.181.224.36";

function networkSecurityXml(host) {
  // Cleartext must be allowed broadly for Metro (LAN IPs like 192.168.x.x /
  // VMware adapters). Android domain-config cannot match IP ranges.
  // API host still uses HTTPS + the embedded self-signed trust anchor.
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Dev client: Metro cleartext (any host) + trust Qchat self-signed TLS. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">${host}</domain>
    <trust-anchors>
      <certificates src="@raw/${RAW_NAME}" />
      <certificates src="system" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;
}

function withTrustedQchatCert(config) {
  if (process.env.QCHAT_TRUST_CERT === "0") {
    console.warn(
      "[withTrustedQchatCert] skipped (QCHAT_TRUST_CERT=0) — production/system CA mode"
    );
    return config;
  }

  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const certPath = path.join(projectRoot, CERT_SRC);
      if (!fs.existsSync(certPath)) {
        throw new Error(
          `[withTrustedQchatCert] Missing ${CERT_SRC}. Copy deploy/certs/qchat.crt from the server.`
        );
      }

      const rawDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "res",
        "raw"
      );
      const xmlDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "res",
        "xml"
      );
      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(xmlDir, { recursive: true });

      // Android raw resources: lowercase a-z0-9_ (no extension → @raw/qchat_cert)
      fs.copyFileSync(certPath, path.join(rawDir, RAW_NAME));
      fs.writeFileSync(
        path.join(xmlDir, "network_security_config.xml"),
        networkSecurityXml(API_HOST),
        "utf8"
      );
      return cfg;
    },
  ]);

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults
    );
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });

  // iOS: ATS alone cannot accept an invalid cert; document device trust separately.
  // Keep exception domain so cleartext fallbacks still work if needed.
  config.ios = config.ios ?? {};
  config.ios.infoPlist = {
    ...(config.ios.infoPlist ?? {}),
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: false,
      NSExceptionDomains: {
        [API_HOST]: {
          NSIncludesSubdomains: true,
          NSExceptionAllowsInsecureHTTPLoads: true,
          NSExceptionRequiresForwardSecrecy: false,
        },
      },
    },
  };

  return config;
}

module.exports = withTrustedQchatCert;
