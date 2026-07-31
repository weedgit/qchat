/**
 * App language preference (en / zh), stored on device. Default: Chinese.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
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

async function loadStoredLocale(): Promise<LocaleMode> {
  try {
    const v = await SecureStore.getItemAsync(LOCALE_KEY);
    const next = normalizeLocaleMode(v);
    // Persist migration away from legacy "system".
    if (v !== next) {
      await SecureStore.setItemAsync(LOCALE_KEY, next).catch(() => {});
    }
    return next;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleMode>(DEFAULT_LOCALE);

  useEffect(() => {
    let cancelled = false;
    loadStoredLocale().then((stored) => {
      if (!cancelled) setLocaleState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((mode: LocaleMode) => {
    setLocaleState(mode);
    SecureStore.setItemAsync(LOCALE_KEY, mode).catch(() => {});
  }, []);

  const resolved = useMemo(() => resolveLocale(locale), [locale]);

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
