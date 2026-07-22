/**
 * Theme preference (dark / light / system), stored on device.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { StyleSheet, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  colorsFor,
  type ColorTokens,
  type ResolvedTheme,
  type ThemeMode,
} from "../theme";

const THEME_KEY = "qchat.theme";

type ThemeContextValue = {
  theme: ThemeMode;
  resolved: ResolvedTheme;
  colors: ColorTokens;
  setTheme: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

async function loadStoredTheme(): Promise<ThemeMode> {
  try {
    const v = await SecureStore.getItemAsync(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [theme, setThemeState] = useState<ThemeMode>("system");

  useEffect(() => {
    let cancelled = false;
    loadStoredTheme().then((stored) => {
      if (!cancelled) setThemeState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    SecureStore.setItemAsync(THEME_KEY, mode).catch(() => {});
  }, []);

  const resolved: ResolvedTheme =
    theme === "system" ? (system === "dark" ? "dark" : "light") : theme;

  const colors = useMemo(() => colorsFor(resolved), [resolved]);

  const value = useMemo(
    () => ({ theme, resolved, colors, setTheme }),
    [theme, resolved, colors, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}

/** Build StyleSheet from current theme colors. Pass a stable module-level factory. */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: ColorTokens) => T
): T {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}

export function themeModeLabel(mode: ThemeMode): string {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "System";
}
