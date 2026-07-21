const { spawn } = require("child_process");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");

function launchElectron(arguments = process.argv.slice(2), options = {}) {
  const electron = require("electron");
  const electronArguments = [APP_ROOT, ...arguments];
  const environment = { ...process.env, ...options.env };

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
