const { app, BrowserWindow, screen, ipcMain } = require("electron");

/** @type {BrowserWindow | null} */
let toastWindow = null;
/** @type {NodeJS.Timeout | null} */
let hideTimer = null;
/** @type {number} */
let lastToastAt = 0;
const MIN_INTERVAL_MS = 2500;
const TOAST_WIDTH = 360;
const TOAST_HEIGHT = 88;

/**
 * Unpackaged Electron on macOS cannot reliably deliver UNNotification banners
 * without a named codesign identity. Show an always-on-top toast window instead.
 */
function shouldUseMacToastFallback() {
  if (process.platform !== "darwin") return false;
  try {
    return !app.isPackaged;
  } catch {
    return true;
  }
}

function sanitizeNotifyText(value) {
  return String(value ?? "")
    .replace(/\u2192/g, "→")
    .replace(/[^\S\r\n]+/g, " ")
    .trim()
    .slice(0, 180);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toastHtml(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  html, body {
    margin: 0; padding: 0; overflow: hidden;
    background: transparent;
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-user-select: none;
    cursor: pointer;
  }
  .toast {
    margin: 8px;
    padding: 12px 14px;
    border-radius: 14px;
    color: #f5f5f5;
    background: rgba(28, 28, 30, 0.92);
    box-shadow: 0 10px 28px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    animation: in 180ms ease-out;
  }
  .brand {
    font-size: 11px; letter-spacing: 0.02em;
    color: #8e8e93; margin-bottom: 4px;
  }
  .title {
    font-size: 14px; font-weight: 600; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .body {
    margin-top: 4px; color: #d1d1d6; line-height: 1.3;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  @keyframes in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style></head>
<body>
  <div class="toast" id="t">
    <div class="brand">XinChat</div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="body">${escapeHtml(body)}</div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    function click() { ipcRenderer.send('qchat-mac-toast-click'); }
    document.getElementById('t').addEventListener('click', click);
    document.body.addEventListener('click', click);
  </script>
</body></html>`;
}

/**
 * @param {{ title: string, body: string, silent?: boolean, onClick?: () => void }} opts
 * @returns {Promise<boolean>}
 */
function showMacToastNotification(opts) {
  const now = Date.now();
  if (now - lastToastAt < MIN_INTERVAL_MS) {
    console.log("[xinchat-desktop] mac toast throttled");
    return Promise.resolve(false);
  }
  lastToastAt = now;

  const title = sanitizeNotifyText(opts.title || "XinChat Desktop") || "XinChat Desktop";
  const body = sanitizeNotifyText(opts.body || "New message") || "New message";

  return new Promise((resolve) => {
    try {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (toastWindow && !toastWindow.isDestroyed()) {
        toastWindow.close();
      }

      const display = screen.getPrimaryDisplay();
      const work = display.workArea;
      const x = Math.round(work.x + work.width - TOAST_WIDTH - 16);
      const y = Math.round(work.y + 16);

      toastWindow = new BrowserWindow({
        width: TOAST_WIDTH,
        height: TOAST_HEIGHT,
        x,
        y,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // Must be focusable or click events are unreliable on macOS.
        focusable: true,
        show: false,
        hasShadow: false,
        titleBarStyle: "hidden",
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });

      toastWindow.setAlwaysOnTop(true, "floating");
      toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      toastWindow.setIgnoreMouseEvents(false);

      const onClick = () => {
        console.log("[xinchat-desktop] mac toast clicked — focusing main window");
        try {
          if (typeof opts.onClick === "function") opts.onClick();
        } catch (err) {
          console.warn(
            "[xinchat-desktop] mac toast onClick failed:",
            err?.message || err
          );
        }
        if (toastWindow && !toastWindow.isDestroyed()) toastWindow.close();
      };
      ipcMain.removeAllListeners("qchat-mac-toast-click");
      ipcMain.once("qchat-mac-toast-click", onClick);

      toastWindow.on("closed", () => {
        ipcMain.removeListener("qchat-mac-toast-click", onClick);
        toastWindow = null;
      });

      toastWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(toastHtml(title, body))}`
      );
      toastWindow.once("ready-to-show", () => {
        if (!toastWindow || toastWindow.isDestroyed()) return;
        // Don't steal focus when appearing — only on click.
        toastWindow.showInactive();
        if (!opts.silent) {
          try {
            const { execFile } = require("child_process");
            execFile(
              "afplay",
              ["/System/Library/Sounds/Glass.aiff"],
              { timeout: 3000 },
              () => {}
            );
          } catch {
            /* ignore */
          }
        }
        console.log("[xinchat-desktop] mac toast window shown:", title);
        resolve(true);
      });

      hideTimer = setTimeout(() => {
        if (toastWindow && !toastWindow.isDestroyed()) toastWindow.close();
      }, 5000);
    } catch (err) {
      console.warn(
        "[xinchat-desktop] mac toast window failed:",
        err?.message || err
      );
      resolve(false);
    }
  });
}

/** @deprecated use shouldUseMacToastFallback */
const shouldUseOsascriptFallback = shouldUseMacToastFallback;
/** @deprecated use showMacToastNotification */
const showOsascriptNotification = showMacToastNotification;

module.exports = {
  shouldUseMacToastFallback,
  showMacToastNotification,
  shouldUseOsascriptFallback,
  showOsascriptNotification,
  sanitizeNotifyText,
};
