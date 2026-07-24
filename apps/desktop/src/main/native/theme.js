const { nativeTheme, BrowserWindow } = require("electron");
const { IPC } = require("../../shared/ipc/channels");

const BG = {
  dark: "#0E1621",
  light: "#e8eef3",
};

/**
 * @returns {"dark" | "light"}
 */
function resolvedOsTheme() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

/**
 * @param {"system" | "light" | "dark"} source
 */
function applyWindowBackgrounds(source) {
  const resolved =
    source === "system" ? resolvedOsTheme() : source === "light" ? "light" : "dark";
  const color = BG[resolved];
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.setBackgroundColor(color);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * @param {unknown} source
 * @returns {"system" | "light" | "dark" | null}
 */
function normalizeThemeSource(source) {
  const s = String(source || "").toLowerCase();
  if (s === "system" || s === "light" || s === "dark") return s;
  return null;
}

/**
 * SHELL-31 — keep Electron nativeTheme / window chrome aligned with OS or app theme.
 * Does not change web CSS tokens; web drives preference via setNativeThemeSource.
 *
 * @param {object} [deps]
 * @param {() => Electron.BrowserWindow | null} [deps.getMainWindow]
 */
function registerThemeSync(deps = {}) {
  // Follow OS until the web client reports an explicit preference.
  if (nativeTheme.themeSource !== "system") {
    nativeTheme.themeSource = "system";
  }
  applyWindowBackgrounds("system");

  nativeTheme.on("updated", () => {
    const payload = {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      themeSource: nativeTheme.themeSource,
      resolved: resolvedOsTheme(),
    };
    // When following system, refresh window chrome to match OS.
    if (nativeTheme.themeSource === "system") {
      applyWindowBackgrounds("system");
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.NATIVE_THEME_UPDATED, payload);
      }
    }
  });

  void deps;
}

/**
 * @param {"system" | "light" | "dark"} source
 * @returns {boolean}
 */
function setNativeThemeSource(source) {
  const normalized = normalizeThemeSource(source);
  if (!normalized) return false;
  if (nativeTheme.themeSource !== normalized) {
    nativeTheme.themeSource = normalized;
  }
  applyWindowBackgrounds(normalized);
  return true;
}

function getNativeThemeState() {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
    resolved: resolvedOsTheme(),
  };
}

module.exports = {
  registerThemeSync,
  setNativeThemeSource,
  getNativeThemeState,
  normalizeThemeSource,
  resolvedOsTheme,
  BG,
};
