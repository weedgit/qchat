const { Menu, clipboard, shell, BrowserWindow } = require("electron");
const {
  shouldShowMenu,
  emailFromMailto,
  isHttpUrl,
  cleanTemplate,
  CUSTOM_CTX_SELECTOR,
} = require("./contextMenuLogic");

/**
 * SHELL-22 — native right-click menu for the main BrowserWindow.
 *
 * Gated so composer / links / images outside chat rows still get a native
 * menu, while message / conversation / member rows keep the web client's
 * Telegram-style context menu.
 */

/**
 * @param {Electron.WebContents} webContents
 * @param {number} x
 * @param {number} y
 * @returns {Promise<boolean>}
 */
async function isCustomContextMenuTarget(webContents, x, y) {
  if (!webContents || webContents.isDestroyed()) return false;
  const px = Number(x) || 0;
  const py = Number(y) || 0;
  // Keep selector in sync with contextMenuLogic.CUSTOM_CTX_SELECTOR.
  const script = `(() => {
    const el = document.elementFromPoint(${px}, ${py});
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(el.closest(${JSON.stringify(CUSTOM_CTX_SELECTOR)}));
  })()`;
  try {
    return Boolean(await webContents.executeJavaScript(script, true));
  } catch {
    return false;
  }
}

/**
 * @param {Electron.BrowserWindow} browserWindow
 * @returns {() => void} dispose
 */
function attachContextMenu(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return () => {};
  }

  const webContents = browserWindow.webContents;

  /** @param {Electron.Event} _event @param {Electron.ContextMenuParams} params */
  const onContextMenu = (_event, params) => {
    void (async () => {
      if (browserWindow.isDestroyed() || webContents.isDestroyed()) return;

      // Chat message / sidebar / member menus are owned by the web UI.
      // Native Menu.popup here steals the gesture on Windows/Electron and
      // the in-page Telegram menu never stays open.
      if (await isCustomContextMenuTarget(webContents, params.x, params.y)) {
        return;
      }

      if (!shouldShowMenu(params)) return;
      if (browserWindow.isDestroyed() || webContents.isDestroyed()) return;

      /** @type {Electron.MenuItemConstructorOptions[]} */
      const template = [];
      const flags = params.editFlags || {};

      const suggestions = params.dictionarySuggestions || [];
      for (const suggestion of suggestions) {
        template.push({
          label: suggestion,
          click: () => {
            if (!webContents.isDestroyed()) {
              webContents.replaceMisspelling(suggestion);
            }
          },
        });
      }
      if (params.misspelledWord) {
        if (suggestions.length) template.push({ type: "separator" });
        template.push({
          label: "Add to Dictionary",
          click: () => {
            try {
              webContents.session.addWordToSpellCheckerDictionary(
                params.misspelledWord
              );
            } catch {
              /* ignore */
            }
          },
        });
        template.push({ type: "separator" });
      }

      if (params.isEditable) {
        template.push(
          { role: "cut", enabled: Boolean(flags.canCut) },
          { role: "copy", enabled: Boolean(flags.canCopy) },
          { role: "paste", enabled: Boolean(flags.canPaste) },
          { role: "selectAll", enabled: Boolean(flags.canSelectAll) }
        );
      } else if (String(params.selectionText || "").trim()) {
        template.push({
          role: "copy",
          enabled: flags.canCopy !== false,
        });
      }

      const linkURL = String(params.linkURL || "");
      if (linkURL) {
        if (template.length) template.push({ type: "separator" });
        const email = emailFromMailto(linkURL);
        if (email) {
          template.push({
            label: "Copy Email Address",
            click: () => clipboard.writeText(email),
          });
        } else {
          template.push({
            label: "Copy Link",
            click: () => clipboard.writeText(linkURL),
          });
          if (isHttpUrl(linkURL)) {
            template.push({
              label: "Open Link",
              click: () => {
                shell.openExternal(linkURL).catch(() => {});
              },
            });
          }
        }
      }

      if (params.mediaType === "image" && params.srcURL) {
        if (template.length) template.push({ type: "separator" });
        template.push({
          label: "Copy Image",
          click: () => {
            try {
              webContents.copyImageAt(params.x, params.y);
            } catch {
              /* ignore */
            }
          },
        });
        // Reuse SHELL-20 download save dialog — do not show a second picker here.
        template.push({
          label: "Save Image As…",
          click: () => {
            try {
              webContents.downloadURL(params.srcURL);
            } catch (err) {
              console.warn(
                "[xinchat-desktop] save image failed:",
                err?.message || err
              );
            }
          },
        });
      }

      const cleaned = cleanTemplate(template);
      if (!cleaned.length) return;

      const menu = Menu.buildFromTemplate(cleaned);
      const win = BrowserWindow.fromWebContents(webContents) || browserWindow;
      menu.popup({ window: win || undefined });
    })();
  };

  webContents.on("context-menu", onContextMenu);

  return () => {
    try {
      if (!webContents.isDestroyed()) {
        webContents.removeListener("context-menu", onContextMenu);
      }
    } catch {
      /* ignore */
    }
  };
}

module.exports = {
  attachContextMenu,
  shouldShowMenu,
  emailFromMailto,
  isCustomContextMenuTarget,
  CUSTOM_CTX_SELECTOR,
};
