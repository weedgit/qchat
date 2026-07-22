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
  LOCALE_KEY,
  isLocaleMode,
  localeModeLabel,
  resolveLocale,
  themeModeLabel as sharedThemeModeLabel,
  translate,
  type LocaleMode,
  type MessageKey,
  type ResolvedLocale,
} from "@qchat/i18n";

type LocaleContextValue = {
  locale: LocaleMode;
  resolved: ResolvedLocale;
  setLocale: (mode: LocaleMode) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  labelLocale: (mode: LocaleMode) => string;
  labelTheme: (mode: "dark" | "light" | "system") => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function systemLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.language || "en";
}

function getStoredLocale(): LocaleMode {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(LOCALE_KEY);
  return isLocaleMode(v) ? v : "system";
}

function applyDocumentLang(resolved: ResolvedLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = resolved === "zh" ? "zh-CN" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleMode>("system");
  const [systemLang, setSystemLang] = useState(systemLanguage);

  useEffect(() => {
    const stored = getStoredLocale();
    setLocaleState(stored);
    applyDocumentLang(resolveLocale(stored, systemLanguage()));

    const onLang = () => setSystemLang(systemLanguage());
    const syncFromStorage = () => {
      const next = getStoredLocale();
      setLocaleState(next);
      applyDocumentLang(resolveLocale(next, systemLanguage()));
    };
    window.addEventListener("languagechange", onLang);
    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("qchat-locale-change", syncFromStorage);
    return () => {
      window.removeEventListener("languagechange", onLang);
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("qchat-locale-change", syncFromStorage);
    };
  }, []);

  const setLocale = useCallback((mode: LocaleMode) => {
    localStorage.setItem(LOCALE_KEY, mode);
    setLocaleState(mode);
    applyDocumentLang(resolveLocale(mode, systemLanguage()));
    window.dispatchEvent(new Event("qchat-locale-change"));
  }, []);

  const resolved = useMemo(
    () => resolveLocale(locale, systemLang),
    [locale, systemLang]
  );

  useEffect(() => {
    applyDocumentLang(resolved);
  }, [resolved]);

  const value = useMemo<LocaleContextValue>(() => {
    const t = (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(resolved, key, vars);
    return {
      locale,
      resolved,
      setLocale,
      t,
      labelLocale: (mode) => localeModeLabel(mode, resolved),
      labelTheme: (mode) => sharedThemeModeLabel(mode, resolved),
    };
  }, [locale, resolved, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale outside LocaleProvider");
  return ctx;
}
