/** Client-side media limits (mirror API kind caps). */

export const AVATAR_MAX_BYTES = 100 * 1024 * 1024;
export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_SEC = 60;
/** requirements-en §2.4: max text message length (Unicode characters / runes). */
export const MESSAGE_MAX_CHARS = 1000;

export function messageCharCount(text: string): number {
  return Array.from(text).length;
}

/** Truncate to MESSAGE_MAX_CHARS by Unicode code point, matching server rune limits. */
export function clipMessageText(text: string, max = MESSAGE_MAX_CHARS): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("");
}

/** Raster avatar types accepted by POST /v1/media/upload (kind=avatar). SVG excluded. */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/gif,image/webp";

const AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export function isAvatarFile(file: File | Blob): boolean {
  const type = (file.type || "").toLowerCase().trim();
  return AVATAR_TYPES.has(type);
}

export function avatarLimitError(file: File): string | null {
  if (!isAvatarFile(file)) return "Avatar must be JPEG, PNG, GIF, or WebP";
  if (file.size > AVATAR_MAX_BYTES) return "Avatar must be 100 MB or less";
  return null;
}

export function isVideoMime(mime: string | undefined | null): boolean {
  return (mime || "").toLowerCase().trim().startsWith("video/");
}

/** Common uploaded video extensions (message body is often the filename). */
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

export function attachmentLimitError(file: File): string | null {
  const max = isVideoMime(file.type) ? VIDEO_MAX_BYTES : FILE_MAX_BYTES;
  if (file.size > max) {
    return isVideoMime(file.type)
      ? "Video must be 200 MB or less"
      : "File must be 100 MB or less";
  }
  return null;
}
