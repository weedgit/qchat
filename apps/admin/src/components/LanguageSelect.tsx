"use client";

import { useLocale } from "@/lib/locale";

type Props = {
  id?: string;
  className?: string;
};

/** Admin language picker — 简体中文 (default) / English. */
export default function LanguageSelect({ id = "admin-lang", className }: Props) {
  const { t, locale, setLocale, labelLocale } = useLocale();

  return (
    <div className={className}>
      <label htmlFor={id} className="muted" style={{ fontSize: 12, display: "block" }}>
        {t("admin.language")}
      </label>
      <select
        id={id}
        value={locale}
        onChange={(e) => setLocale(e.target.value as "en" | "zh")}
        style={{ width: "100%", marginTop: 4 }}
        aria-label={t("admin.language")}
      >
        <option value="zh">{labelLocale("zh")}</option>
        <option value="en">{labelLocale("en")}</option>
      </select>
    </div>
  );
}
