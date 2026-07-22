const { Menu, clipboard, shell, BrowserWindow } = require("electron");
const {
  shouldShowMenu,
  emailFromMailto,
  isHttpUrl,
  cleanTemplate,
} = require("./contextMenuLogic");

/**
 * SHELL-22 — native right-click menu for the main BrowserWindow.
 *
 * Intentionally gated (Mattermost shouldShowMenu): do not open on empty /
 * button clicks so the web client's message / member context menus keep working.
 */

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
              "[qchat-desktop] save image failed:",
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
};
