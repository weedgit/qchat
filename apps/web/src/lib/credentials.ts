/** Client-side credential checks mirroring services/api/internal/auth/password.go */

const phoneRe = /^\d{11}$/;
const passwordRe = /^[A-Za-z0-9]{8,}$/;

export function isValidPhone(phone: string): boolean {
  return phoneRe.test(phone.trim());
}

function codePointCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    n += 1;
    i += cp > 0xffff ? 2 : 1;
  }
  return n;
}

/** Username: 2–32 letters/digits/underscore/emoji (approx. Go `\p{L}\p{N}_\p{So}`). */
export function isValidUsername(name: string): boolean {
  const s = name.trim();
  const len = codePointCount(s);
  if (len < 2 || len > 32) return false;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) return false;
    const ch = String.fromCodePoint(cp);
    if (!/^[0-9A-Za-z_]$/.test(ch) && cp <= 127) {
      return false;
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return true;
}

/**
 * Display name: 2–64 letters/digits/spaces/underscore/emoji; no ASCII special symbols.
 * Mirrors auth.ValidateDisplayName.
 */
export function isValidDisplayName(name: string): boolean {
  const s = name.trim();
  const len = codePointCount(s);
  if (len < 2 || len > 64) return false;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) return false;
    const ch = String.fromCodePoint(cp);
    if (ch === " " || /^[0-9A-Za-z_]$/.test(ch)) {
      i += 1;
      continue;
    }
    if (cp <= 127) {
      return false;
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return true;
}

export function displayNameError(name: string): string | null {
  if (!isValidDisplayName(name)) {
    return "Display name must be 2–64 letters, digits, spaces, underscores, or emoji (no special symbols)";
  }
  return null;
}

export function passwordError(password: string): string | null {
  if (!passwordRe.test(password)) {
    return "login.errPassword";
  }
  return null;
}

/** Returns an i18n message key, or null when phone/password(/username) look valid. */
export function validateLoginCredentials(opts: {
  phone: string;
  password: string;
  username?: string;
  requireUsername?: boolean;
}): string | null {
  if (!isValidPhone(opts.phone)) {
    return "login.errPhone";
  }
  const pwErr = passwordError(opts.password);
  if (pwErr) return pwErr;
  if (opts.requireUsername) {
    const u = (opts.username ?? "").trim();
    if (!u) return "login.errUsernameRequired";
    if (!isValidUsername(u)) {
      return "login.errUsernameInvalid";
    }
  }
  return null;
}
