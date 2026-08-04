import type { MessageKey } from "@qchat/i18n";

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

export function displayNameError(name: string): MessageKey | null {
  if (!isValidDisplayName(name)) {
    return "admin.err.displayNameRule";
  }
  return null;
}

export function passwordError(password: string): MessageKey | null {
  if (!passwordRe.test(password)) {
    return "admin.err.passwordRule";
  }
  return null;
}

/** Returns a message key, or null when phone/password look valid. */
export function validateLoginCredentials(opts: {
  phone: string;
  password: string;
}): MessageKey | null {
  if (!isValidPhone(opts.phone)) {
    return "admin.err.phone11";
  }
  if (!passwordRe.test(opts.password)) {
    return "admin.err.passwordRule";
  }
  return null;
}
