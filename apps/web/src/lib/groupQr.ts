/** Group invite QR payload helpers (JD join-via-QR; has no group QR). */

const JOIN_PREFIX = "qchat://join/";

/** Encode a group public_id into a scannable invite payload. */
export function encodeGroupJoinPayload(publicId: string): string {
  const id = publicId.trim();
  if (!id) return "";
  return `${JOIN_PREFIX}${id}`;
}

/**
 * Extract a group public_id from typed/pasted/scanned text.
 * Accepts raw IDs (Gxxxxxxxx) or qchat://join/… payloads.
 */
export function parseGroupJoinPayload(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith(JOIN_PREFIX)) {
    const id = text.slice(JOIN_PREFIX.length).trim();
    return id || null;
  }
  try {
    const url = new URL(text);
    if (url.protocol === "qchat:" && url.hostname === "join") {
      const id = url.pathname.replace(/^\//, "").trim();
      return id || null;
    }
  } catch {
    /* not a URL */
  }
  // Raw public_id e.g. Gxxxxxxxx
  if (/^G[A-Za-z0-9]+$/i.test(text)) return text;
  return null;
}
