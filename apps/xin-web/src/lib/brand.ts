/** XinChat client branding (shared backend with Rchat). */
import {
  normalizeLocaleMode,
  resolveLocale,
  type MessageKey,
  type ResolvedLocale,
} from "@qchat/i18n";

export const APP_NAME = "XinChat";
export const APP_LOGO_LETTER = "X";
export const APP_BASE_PATH = "/xin";

/** Same server — other branded client (for login cross-link). */
const rchatOrigin = (process.env.NEXT_PUBLIC_RCHAT_ORIGIN || "").replace(/\/$/, "");
export const SIBLING_APP = {
  name: "Rchat",
  loginHref: rchatOrigin ? `${rchatOrigin}/login` : "/login",
} as const;

/** localStorage keys — must not collide with Rchat on the same origin. */
export const STORAGE_KEYS = {
  locale: "xinchat.locale",
  theme: "xinchat.theme",
} as const;

/** Override shared i18n strings that still say Rchat. */
export const I18N_OVERRIDES: Partial<Record<MessageKey, string>> = {
  "app.name": APP_NAME,
};

export function getStoredResolvedLocale(): ResolvedLocale {
  if (typeof window === "undefined") return "zh";
  return resolveLocale(normalizeLocaleMode(localStorage.getItem(STORAGE_KEYS.locale)));
}

export function withBasePath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (APP_BASE_PATH && path.startsWith(`${APP_BASE_PATH}/`)) return path;
  return `${APP_BASE_PATH}${path}`;
}

export function overrideI18n(key: MessageKey, fallback: string): string {
  return I18N_OVERRIDES[key] ?? fallback;
}
