const { spawn } = require("child_process");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");

function launchElectron(arguments = process.argv.slice(2), options = {}) {
  const electron = require("electron");
  const electronArguments = [APP_ROOT, ...arguments];
  // Cursor/CI often set ELECTRON_RUN_AS_NODE=1; that makes Electron act like plain
  // Node so `require("electron").app` is undefined and the shell crashes on boot.
  const environment = { ...process.env, ...options.env };
  delete environment.ELECTRON_RUN_AS_NODE;

  if (
    process.platform === "linux" &&
    environment.QCHAT_DESKTOP_NO_SANDBOX === "1" &&
    !electronArguments.includes("--no-sandbox")
  ) {
    electronArguments.push("--no-sandbox");
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
