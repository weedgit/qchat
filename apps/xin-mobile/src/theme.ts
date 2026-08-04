/** XinChat mobile theme — violet palette (distinct from Rchat blue). */
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
  accent: "#7c3aed",
  accentDark: "#6d28d9",
  headerBlue: "#6d28d9",
  bg: "#f5f3ff",
  surface: "#ffffff",
  text: "#1e1b4b",
  textSecondary: "#6b7280",
  textMuted: "#9ca3af",
  border: "#e4e0f5",
  unread: "#ef4444",
  online: "#22c55e",
  bubbleMine: "#7c3aed",
  bubblePeer: "#ffffff",
  danger: "#dc2626",
  inputBg: "#f3f4f6",
};

export const darkColors: ColorTokens = {
  accent: "#a78bfa",
  accentDark: "#8b5cf6",
  headerBlue: "#1c1630",
  bg: "#14101f",
  surface: "#1c1630",
  text: "#f5f3ff",
  textSecondary: "#a5b4c8",
  textMuted: "#7c8699",
  border: "#2a2444",
  unread: "#ef4444",
  online: "#22c55e",
  bubbleMine: "#6d28d9",
  bubblePeer: "#252040",
  danger: "#f87171",
  inputBg: "#252040",
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
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
};

export function colorsFor(resolved: ResolvedTheme): ColorTokens {
  return resolved === "dark" ? darkColors : lightColors;
}
