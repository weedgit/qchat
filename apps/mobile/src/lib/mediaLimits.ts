/** Client-side media helpers (mirror apps/web/src/lib/mediaLimits.ts). */

export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const FILE_MAX_BYTES = 100 * 1024 * 1024;

export function isVideoMime(mime: string | undefined | null): boolean {
  return (mime || "").toLowerCase().trim().startsWith("video/");
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|ogv|avi)(?:$|[?#])/i;

/** True when any hint looks like a video attachment (MIME, filename, or media URL). */
export function isVideoAttachmentHint(
  ...hints: Array<string | undefined | null>
): boolean {
  for (const hint of hints) {
    if (!hint) continue;
    const value = hint.trim();
    if (!value) continue;
    if (isVideoMime(value)) return true;
    if (VIDEO_EXT_RE.test(value)) return true;
  }
  return false;
}
