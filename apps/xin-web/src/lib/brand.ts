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

/** localStorage keys — must not collide with Rchat on the same origin. */
export const STORAGE_KEYS = {
  locale: "xinchat.locale",
  theme: "xinchat.theme",
} as const;

/** Non–app.name overrides (shared @qchat/i18n strings without "Rchat" in the source). */
const XIN_I18N_OVERRIDES: Record<ResolvedLocale, Partial<Record<MessageKey, string>>> = {
  en: {
    "app.name": APP_NAME,
    "pwa.installBody": "Install for faster launch and a full-screen chat experience.",
    "settings.installAppHint": "Add XinChat to your home screen for a full-screen app experience.",
  },
  zh: {
    "app.name": APP_NAME,
    "pwa.installBody": "安装后启动更快，并以全屏方式聊天。",
    "settings.installAppHint": "添加到主屏幕，获得全屏应用体验。",
  },
};

function brandText(text: string): string {
  return text.replace(/\bRchat\b/g, APP_NAME);
}

export function getStoredResolvedLocale(): ResolvedLocale {
  if (typeof window === "undefined") return "zh";
  return resolveLocale(normalizeLocaleMode(localStorage.getItem(STORAGE_KEYS.locale)));
}

export function withBasePath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (APP_BASE_PATH && path.startsWith(`${APP_BASE_PATH}/`)) return path;
  return `${APP_BASE_PATH}${path}`;
}

export function overrideI18n(
  key: MessageKey,
  fallback: string,
  resolved: ResolvedLocale,
): string {
  const explicit = XIN_I18N_OVERRIDES[resolved][key];
  return brandText(explicit ?? fallback);
}
