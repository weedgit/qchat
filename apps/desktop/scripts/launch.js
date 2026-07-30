const { spawn } = require("child_process");
const path = require("path");
const { signDevElectron } = require("./sign-dev-electron");

const APP_ROOT = path.resolve(__dirname, "..");

/**
 * Unpackaged launcher only. Packaged installers never go through this file.
 *
 * --no-sandbox is opt-in for Linux VMs (PACK-07): argv `--no-sandbox` or
 * QCHAT_DESKTOP_NO_SANDBOX=1. Never implied for normal start / start:server.
 */
function launchElectron(argumentsList = process.argv.slice(2), options = {}) {
  // Electron 42+: drop linker-signed flag so the app can boot cleanly.
  // Unpackaged Mac message toasts use the in-app window (macNotify), so a
  // trusted "Electron Dev" identity is optional — fall back to ad-hoc.
  if (process.platform === "darwin") {
    const signed = signDevElectron();
    if (!signed.ok) {
      console.warn(
        "[qchat-desktop] Electron.app signing skipped:",
        signed.reason
      );
    } else if (!signed.skipped) {
      console.log(
        `[qchat-desktop] Electron.app signed (${signed.identity})`
      );
    }
  }

  const electron = require("electron");
  const electronArguments = [APP_ROOT, ...argumentsList];
  // Cursor/CI often set ELECTRON_RUN_AS_NODE=1; that makes Electron act like plain
  // Node so `require("electron").app` is undefined and the shell crashes on boot.
  const environment = { ...process.env, ...options.env };
  delete environment.ELECTRON_RUN_AS_NODE;

  // Cursor's integrated terminal injects a *local* HTTP/SOCKS proxy (127.0.0.1).
  // That tunnel fails with ERR_TUNNEL_CONNECTION_FAILED (-111). Strip only those;
  // keep a real user/system proxy (e.g. HTTP_PROXY with credentials).
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "SOCKS_PROXY",
    "SOCKS5_PROXY",
    "socks_proxy",
    "socks5_proxy",
    "GIT_HTTP_PROXY",
    "GIT_HTTPS_PROXY",
  ]) {
    const value = String(environment[key] || "");
    if (
      /127\.0\.0\.1|\[::1\]|localhost/i.test(value) ||
      // Cursor sandbox restore blob — never pass through to Electron.
      key.startsWith("__CURSOR_")
    ) {
      delete environment[key];
    }
  }

  const wantsNoSandbox =
    electronArguments.includes("--no-sandbox") ||
    environment.QCHAT_DESKTOP_NO_SANDBOX === "1";

  if (wantsNoSandbox && process.platform === "linux") {
    if (!electronArguments.includes("--no-sandbox")) {
      electronArguments.push("--no-sandbox");
    }
    console.warn(
      "[qchat-desktop] Chromium --no-sandbox enabled (dev/VM only). Do not use for packaged releases."
    );
  }

  return spawn(electron, electronArguments, {
    cwd: APP_ROOT,
    env: environment,
    stdio: "inherit",
  });
}

if (require.main === module) {
  const electron = launchElectron();
  electron.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

module.exports = { launchElectron };
