"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  localeModeLabel,
  resolveLocale,
  translate,
  type LocaleMode,
  type MessageKey,
  type ResolvedLocale,
} from "@qchat/i18n";

export const ADMIN_LOCALE_KEY = "qchat.admin.locale";

type LocaleContextValue = {
  locale: LocaleMode;
  resolved: ResolvedLocale;
  setLocale: (mode: LocaleMode) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  labelLocale: (mode: LocaleMode) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getStoredLocale(): LocaleMode {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const raw = localStorage.getItem(ADMIN_LOCALE_KEY);
  if (raw === "en" || raw === "zh") return raw;
  // First visit: Chinese default (admin does not inherit web qchat.locale).
  return DEFAULT_LOCALE;
}

function seedDefaultLocale(): LocaleMode {
  const stored = getStoredLocale();
  if (typeof window !== "undefined" && !localStorage.getItem(ADMIN_LOCALE_KEY)) {
    localStorage.setItem(ADMIN_LOCALE_KEY, stored);
  }
  return stored;
}

function applyDocumentLang(resolved: ResolvedLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = resolved === "zh" ? "zh-CN" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleMode>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = seedDefaultLocale();
    setLocaleState(stored);
    applyDocumentLang(resolveLocale(stored));
    setReady(true);

    const sync = () => setLocaleState(getStoredLocale());
    window.addEventListener("storage", sync);
    window.addEventListener("qchat-admin-locale-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("qchat-admin-locale-change", sync);
    };
  }, []);

  const setLocale = useCallback((mode: LocaleMode) => {
    localStorage.setItem(ADMIN_LOCALE_KEY, mode);
    setLocaleState(mode);
    applyDocumentLang(resolveLocale(mode));
    window.dispatchEvent(new Event("qchat-admin-locale-change"));
  }, []);

  const resolved = useMemo(() => resolveLocale(locale), [locale]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(resolved, key, vars),
    [resolved]
  );

  const labelLocale = useCallback(
    (mode: LocaleMode) => localeModeLabel(mode, resolved),
    [resolved]
  );

  const value = useMemo(
    () => ({ locale, resolved, setLocale, t, labelLocale }),
    [locale, resolved, setLocale, t, labelLocale]
  );

  return (
    <LocaleContext.Provider value={value}>
      {ready ? children : null}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
