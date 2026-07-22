/** 随行聊-inspired tokens for Qchat mobile (light + dark). */
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
  accent: "#2463dc",
  accentDark: "#1a4fb8",
  headerBlue: "#2463dc",
  bg: "#f5f6f8",
  surface: "#ffffff",
  text: "#1a1d24",
  textSecondary: "#6b7280",
  textMuted: "#9ca3af",
  border: "#e8eaed",
  unread: "#ef4444",
  online: "#22c55e",
  bubbleMine: "#2463dc",
  bubblePeer: "#ffffff",
  danger: "#dc2626",
  inputBg: "#f3f4f6",
};

/** Dark theme color tokens. */
export const darkColors: ColorTokens = {
  accent: "#4a9eff",
  accentDark: "#2463dc",
  headerBlue: "#1a2332",
  bg: "#0d1724",
  surface: "#17212b",
  text: "#e8eaed",
  textSecondary: "#9aa4b2",
  textMuted: "#6b7785",
  border: "#2a3544",
  unread: "#ef4444",
  online: "#22c55e",
  bubbleMine: "#2463dc",
  bubblePeer: "#1e2a38",
  danger: "#f87171",
  inputBg: "#1e2a38",
};

/** Default export for modules that still import static colors (light). Prefer useTheme(). */
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
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export function colorsFor(resolved: ResolvedTheme): ColorTokens {
  return resolved === "dark" ? darkColors : lightColors;
}
