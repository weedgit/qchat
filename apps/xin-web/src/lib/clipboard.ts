/**
 * Copy plain text to the system clipboard.
 * Desktop: prefer Electron IPC (navigator.clipboard is often denied in the shell).
 * Web: Clipboard API, then execCommand fallback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text ?? "";
  if (!value) return false;

  const desk = typeof window !== "undefined" ? window.xinchatDesktop : undefined;
  if (desk?.writeClipboardText) {
    try {
      const res = await desk.writeClipboardText(value);
      if (res?.ok) return true;
    } catch {
      /* fall through */
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through */
    }
  }

  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
