const { spawn } = require("child_process");
const path = require("path");
const { launchElectron } = require("./launch");

const DESKTOP_ROOT = path.resolve(__dirname, "..");
const WEB_ROOT = path.resolve(DESKTOP_ROOT, "../web");
const WEB_URL = process.env.QCHAT_WEB_URL || "http://localhost:3000";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function webIsReady() {
  try {
    await fetch(WEB_URL, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function waitForWeb(webProcess) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (webProcess.exitCode !== null) {
      throw new Error(`Web development server exited with code ${webProcess.exitCode}`);
    }
    if (await webIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${WEB_URL}`);
}

async function main() {
  let webProcess;
  if (!(await webIsReady())) {
    console.log(`Starting Qchat web development server at ${WEB_URL}`);
    webProcess = spawn(npm, ["run", "dev"], {
      cwd: WEB_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    await waitForWeb(webProcess);
  } else {
    console.log(`Using the web development server already running at ${WEB_URL}`);
  }

  const electron = launchElectron([
    "--dev",
    `--url=${WEB_URL}`,
    ...process.argv.slice(2),
  ]);
  const shutdown = () => {
    electron.kill();
    webProcess?.kill();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  electron.on("exit", (code) => {
    webProcess?.kill();
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
