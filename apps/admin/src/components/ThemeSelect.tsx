"use client";

import { useLocale } from "@/lib/locale";
import { useAdminTheme } from "@/lib/AdminThemeContext";

/** Light / dark (black) admin chrome — does not change accent palette. */
export default function ThemeSelect() {
  const { t } = useLocale();
  const { theme, setTheme } = useAdminTheme();

  return (
    <div className="admin-theme-select">
      <span className="admin-theme-label">{t("admin.theme")}</span>
      <div className="admin-theme-options" role="group" aria-label={t("admin.theme")}>
        <button
          type="button"
          className={`admin-theme-option ${theme === "light" ? "active" : ""}`}
          onClick={() => setTheme("light")}
          aria-pressed={theme === "light"}
        >
          {t("admin.theme.light")}
        </button>
        <button
          type="button"
          className={`admin-theme-option ${theme === "dark" ? "active" : ""}`}
          onClick={() => setTheme("dark")}
          aria-pressed={theme === "dark"}
        >
          {t("admin.theme.dark")}
        </button>
      </div>
    </div>
  );
}
