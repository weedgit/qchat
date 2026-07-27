/** User profile QR payload helpers (`qchat://user/{username}`). */

const USER_PREFIX = "qchat://user/";

/** Encode a username into a scannable profile payload. */
export function encodeUserPayload(username: string): string {
  const u = username.trim().replace(/^@+/, "");
  if (!u) return "";
  return `${USER_PREFIX}${encodeURIComponent(u)}`;
}

/**
 * Extract a username from typed/pasted/scanned text.
 * Accepts `@name`, raw usernames, or `qchat://user/…` payloads.
 */
export function parseUserPayload(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith(USER_PREFIX)) {
    const u = decodeURIComponent(text.slice(USER_PREFIX.length).trim());
    return u || null;
  }
  try {
    const url = new URL(text);
    if (url.protocol === "qchat:" && url.hostname === "user") {
      const u = decodeURIComponent(url.pathname.replace(/^\//, "").trim());
      return u || null;
    }
  } catch {
    /* not a URL */
  }
  if (text.startsWith("@") && text.length > 1) {
    return text.slice(1).trim() || null;
  }
  return null;
}
