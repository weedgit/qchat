/** Client-side media limits (mirror API kind caps). */

export const AVATAR_MAX_BYTES = 100 * 1024 * 1024;
export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_SEC = 60;

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

export function attachmentLimitError(file: File): string | null {
  const max = (file.type || "").startsWith("video/") ? VIDEO_MAX_BYTES : FILE_MAX_BYTES;
  if (file.size > max) {
    return (file.type || "").startsWith("video/")
      ? "Video must be 200 MB or less"
      : "File must be 100 MB or less";
  }
  return null;
}
