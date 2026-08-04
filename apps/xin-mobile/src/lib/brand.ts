/** XinChat mobile branding (same API as Rchat). */
import type { MessageKey } from "@qchat/i18n";

export const APP_NAME = "XinChat";
export const APP_LOGO_LETTER = "X";

/** Same server — other branded client (login cross-link opens Rchat web). */
export const SIBLING_APP = {
  name: "Rchat",
  loginPath: "/login",
} as const;

export const STORAGE_KEYS = {
  locale: "xinchat.locale",
} as const;

export const I18N_OVERRIDES: Partial<Record<MessageKey, string>> = {
  "app.name": APP_NAME,
};

export function overrideI18n(key: MessageKey, fallback: string): string {
  return I18N_OVERRIDES[key] ?? fallback;
}

/** Rchat web login on the same API host (for mobile login hint). */
export function siblingLoginUrl(apiBase: string): string {
  const base = apiBase.trim().replace(/\/$/, "");
  if (!base) return "";
  return `${base}${SIBLING_APP.loginPath}`;
}
