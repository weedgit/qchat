/** Download chat media (images/files) for Save actions on web + Electron. */

import { mediaAuthURL } from "./api";

function basenameFromURL(url: string): string {
  try {
    const path = url.split("?")[0] || url;
    const parts = path.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "download";
    return decodeURIComponent(last) || "download";
  } catch {
    return "download";
  }
}

function withDownloadFlag(url: string): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

function guessMime(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

/**
 * Saves a remote media URL to disk, preferring a real Save As dialog:
 * 1) Electron desktop → native Save As (will-download)
 * 2) Chromium File System Access API → showSaveFilePicker
 * 3) Fallback `<a download>` blob click
 */
export async function saveMediaToDisk(
  mediaUrl: string,
  preferredName?: string
): Promise<void> {
  const authed = mediaAuthURL(mediaUrl);
  if (!authed) throw new Error("missing media url");
  const fileName = preferredName || basenameFromURL(authed);

  // Desktop: downloadURL hits session will-download → dialog.showSaveDialog.
  const desk = typeof window !== "undefined" ? window.xinchatDesktop : undefined;
  if (desk?.isDesktop && typeof desk.downloadURL === "function") {
    if (authed.startsWith("blob:") || authed.startsWith("data:")) {
      // Native downloadURL needs http(s); fall through to picker/blob.
    } else {
      const result = await desk.downloadURL(withDownloadFlag(authed));
      if (result?.ok) return;
      throw new Error(result?.error || "desktop download failed");
    }
  }

  if (authed.startsWith("blob:") || authed.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = authed;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  const res = await fetch(withDownloadFlag(authed), { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`download failed (${res.status})`);
  }
  const blob = await res.blob();

  // Browser Save As picker (Chrome/Edge; available in secure contexts).
  const w = window as Window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const mime = blob.type || guessMime(fileName);
      const ext = fileName.includes(".")
        ? `.${fileName.split(".").pop()}`
        : "";
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: ext
          ? [
              {
                description: "Media",
                accept: { [mime]: [ext] },
              },
            ]
          : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      // User cancelled the picker — not an error.
      if (err?.name === "AbortError") return;
      // Unsupported / insecure context → fall through.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function mediaIsSavable(msg: {
  recalled?: boolean;
  mediaUrl?: string;
  type?: string;
}): boolean {
  if (msg.recalled || !msg.mediaUrl) return false;
  const t = msg.type || "";
  return t === "image" || t === "file" || t === "video" || t === "voice";
}
