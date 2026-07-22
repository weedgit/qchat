/**
 * App language preference (en / zh / system), stored on device.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NativeModules, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
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

function deviceLanguage(): string {
  try {
    if (Platform.OS === "ios") {
      const settings = NativeModules.SettingsManager?.settings;
      const langs = settings?.AppleLanguages;
      if (Array.isArray(langs) && langs[0]) return String(langs[0]);
      if (settings?.AppleLocale) return String(settings.AppleLocale);
    }
    const locale =
      NativeModules.I18nManager?.localeIdentifier ||
      NativeModules.I18nManager?.locale ||
      "";
    if (locale) return String(locale).replace("_", "-");
  } catch {
    /* ignore */
  }
  return "en";
}

async function loadStoredLocale(): Promise<LocaleMode> {
  try {
    const v = await SecureStore.getItemAsync(LOCALE_KEY);
    if (isLocaleMode(v)) return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleMode>("system");
  const systemLang = useMemo(() => deviceLanguage(), []);

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

  const resolved = useMemo(
    () => resolveLocale(locale, systemLang),
    [locale, systemLang]
  );

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
