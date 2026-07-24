/**
 * PACK-07 — after electron-builder packs the app, fix Linux chrome-sandbox
 * setuid so the Chromium sandbox works in .deb (and similar) installs.
 * Skips AppImage / Snap (Mattermost afterPack pattern).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SETUID_PERMISSIONS = "4755";

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;

  const sandboxPath = path.join(context.appOutDir, "chrome-sandbox");
  if (!fs.existsSync(sandboxPath)) {
    console.warn(
      "[qchat-desktop afterPack] chrome-sandbox not found; skipping setuid"
    );
    return;
  }

  const targets = Array.isArray(context.targets) ? context.targets : [];
  const skipAll =
    targets.length > 0 &&
    targets.every((t) => {
      const name = String(t?.name || "").toLowerCase();
      return name.includes("appimage") || name.includes("snap");
    });
  if (skipAll) return;

  const label =
    targets.map((t) => String(t?.name || "")).filter(Boolean).join(",") ||
    "linux";
  const result = spawnSync("chmod", [SETUID_PERMISSIONS, sandboxPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail =
      `${result.error || ""} ${result.stderr || ""} ${result.stdout || ""}`.trim();
    throw new Error(
      `Failed to chmod chrome-sandbox for ${label}: ${detail}`
    );
  }
  console.log(
    `[qchat-desktop afterPack] set ${SETUID_PERMISSIONS} on chrome-sandbox (${label})`
  );
};
