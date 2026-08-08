export type AdminTheme = "light" | "dark";

const STORAGE_KEY = "qchat:admin-theme";

export function getStoredAdminTheme(): AdminTheme {
  if (typeof window === "undefined") return "dark";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark") return raw;
  return "dark";
}

export function setStoredAdminTheme(theme: AdminTheme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function applyAdminTheme(theme: AdminTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
}
