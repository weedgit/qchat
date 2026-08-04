const { clipboard } = require("electron");

/**
 * Write plain text via Electron clipboard (renderer Clipboard API is often blocked).
 * @returns {(_event: Electron.IpcMainInvokeEvent, text: unknown) => Promise<{ ok: boolean }>}
 */
function createWriteClipboardTextHandler() {
  return async (_event, text) => {
    if (typeof text !== "string" || !text) {
      return { ok: false };
    }
    // Cap to avoid accidental huge IPC payloads.
    const value = text.length > 200_000 ? text.slice(0, 200_000) : text;
    clipboard.writeText(value);
    return { ok: true };
  };
}

module.exports = { createWriteClipboardTextHandler };
