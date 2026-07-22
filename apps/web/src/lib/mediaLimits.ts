/** Client-side media limits (mirror API kind caps). */

export const AVATAR_MAX_BYTES = 100 * 1024 * 1024;
export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_SEC = 60;

export function isAvatarFile(file: File | Blob): boolean {
  return (file.type || "").startsWith("image/");
}

export function avatarLimitError(file: File): string | null {
  if (!isAvatarFile(file)) return "Avatar must be an image";
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
