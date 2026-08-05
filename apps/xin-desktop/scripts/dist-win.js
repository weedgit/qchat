const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(APP_ROOT, "dist");
const UNPACKED_DIR = path.join(DIST_DIR, "win-unpacked");

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killRunningApp() {
  if (process.platform !== "win32") {
    return;
  }

  for (const imageName of ["XinChat Desktop.exe", "electron.exe"]) {
    try {
      execFileSync("taskkill", ["/F", "/IM", imageName, "/T"], {
        stdio: "ignore",
      });
    } catch {
      /* not running */
    }
  }
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function prepareOutputDir() {
  killRunningApp();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!fs.existsSync(UNPACKED_DIR) || removeDir(UNPACKED_DIR)) {
      return { outputDir: DIST_DIR, cleanup: null };
    }
    sleep(400);
  }

  const tempOutput = path.join(
    os.tmpdir(),
    `xinchat-desktop-build-${Date.now()}`
  );
  console.warn(
    `[xinchat-desktop] ${UNPACKED_DIR} is locked; building in ${tempOutput}`
  );
  return { outputDir: tempOutput, cleanup: tempOutput };
}

function copyArtifacts(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });

  for (const entry of fs.readdirSync(fromDir)) {
    if (entry === "win-unpacked") {
      continue;
    }

    const source = path.join(fromDir, entry);
    const target = path.join(toDir, entry);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  }
}

function run() {
  const { outputDir, cleanup } = prepareOutputDir();
  const result = spawnSync(
    "npx",
    [
      "electron-builder",
      "--win",
      "nsis",
      "--publish",
      "never",
      `--config.directories.output=${outputDir}`,
    ],
    { cwd: APP_ROOT, stdio: "inherit", env: process.env, shell: true }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (outputDir !== DIST_DIR) {
    copyArtifacts(outputDir, DIST_DIR);
    console.log(`[xinchat-desktop] Installer copied to dist/`);
  }

  if (cleanup) {
    removeDir(cleanup);
  }
}

run();
