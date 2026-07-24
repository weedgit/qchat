const { spawn } = require("child_process");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");

/**
 * Unpackaged launcher only. Packaged installers never go through this file.
 *
 * --no-sandbox is opt-in for Linux VMs (PACK-07): argv `--no-sandbox` or
 * QCHAT_DESKTOP_NO_SANDBOX=1. Never implied for normal start / start:server.
 */
function launchElectron(argumentsList = process.argv.slice(2), options = {}) {
  const electron = require("electron");
  const electronArguments = [APP_ROOT, ...argumentsList];
  // Cursor/CI often set ELECTRON_RUN_AS_NODE=1; that makes Electron act like plain
  // Node so `require("electron").app` is undefined and the shell crashes on boot.
  const environment = { ...process.env, ...options.env };
  delete environment.ELECTRON_RUN_AS_NODE;

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
