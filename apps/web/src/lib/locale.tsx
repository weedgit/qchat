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
  LOCALE_KEY,
  localeModeLabel,
  normalizeLocaleMode,
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

function getStoredLocale(): LocaleMode {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return normalizeLocaleMode(localStorage.getItem(LOCALE_KEY));
}

function applyDocumentLang(resolved: ResolvedLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = resolved === "zh" ? "zh-CN" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleMode>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = getStoredLocale();
    // Persist migration away from legacy "system".
    if (localStorage.getItem(LOCALE_KEY) !== stored) {
      localStorage.setItem(LOCALE_KEY, stored);
    }
    setLocaleState(stored);
    applyDocumentLang(resolveLocale(stored));

    const syncFromStorage = () => {
      const next = getStoredLocale();
      setLocaleState(next);
      applyDocumentLang(resolveLocale(next));
    };
    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("qchat-locale-change", syncFromStorage);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("qchat-locale-change", syncFromStorage);
    };
  }, []);

  const setLocale = useCallback((mode: LocaleMode) => {
    localStorage.setItem(LOCALE_KEY, mode);
    setLocaleState(mode);
    applyDocumentLang(resolveLocale(mode));
    window.dispatchEvent(new Event("qchat-locale-change"));
  }, []);

  const resolved = useMemo(() => resolveLocale(locale), [locale]);

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
