/** XinChat mobile theme — emerald green (distinct from Rchat blue). */
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export type ColorTokens = {
  accent: string;
  accentDark: string;
  headerBlue: string;
  bg: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  unread: string;
  online: string;
  bubbleMine: string;
  bubblePeer: string;
  danger: string;
  inputBg: string;
};

export const lightColors: ColorTokens = {
  accent: "#059669",
  accentDark: "#047857",
  headerBlue: "#047857",
  bg: "#f0fdf4",
  surface: "#ffffff",
  text: "#064e3b",
  textSecondary: "#047857",
  textMuted: "#6b9080",
  border: "#bbf7d0",
  unread: "#ef4444",
  online: "#22c55e",
  bubbleMine: "#059669",
  bubblePeer: "#ffffff",
  danger: "#dc2626",
  inputBg: "#ecfdf5",
};

export const darkColors: ColorTokens = {
  accent: "#34d399",
  accentDark: "#2dd4bf",
  headerBlue: "#0f2922",
  bg: "#050f0c",
  surface: "#0f1f1a",
  text: "#ecfdf5",
  textSecondary: "#a7f3d0",
  textMuted: "#6ee7b7",
  border: "#1e3a32",
  unread: "#fb7185",
  online: "#4ade80",
  bubbleMine: "#047857",
  bubblePeer: "#152a24",
  danger: "#fb7185",
  inputBg: "#152a24",
};

export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 22,
  pill: 999,
};

export function colorsFor(resolved: ResolvedTheme): ColorTokens {
  return resolved === "dark" ? darkColors : lightColors;
}
