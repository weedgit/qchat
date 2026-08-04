import type { ResolvedLocale } from "@qchat/i18n";

/** Backup folder IDs use `YYYYMMDDTHHMMSSZ`; normalize for Date parsing. */
export function parseBackupStamp(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (!m) return raw;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function localeTag(resolved: ResolvedLocale): string {
  return resolved === "zh" ? "zh-CN" : "en-US";
}

/** Locale-aware display for API timestamps (ISO, RFC3339, etc.). */
export function formatAdminDateTime(
  value: string | null | undefined,
  resolved: ResolvedLocale
): string {
  const parts = formatAdminDateParts(value, resolved);
  if (!parts) return value?.trim() ? value : "—";
  return `${parts.date} ${parts.time}`;
}

export function formatAdminDateParts(
  value: string | null | undefined,
  resolved: ResolvedLocale
): { date: string; time: string } | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const tag = localeTag(resolved);
  return {
    date: new Intl.DateTimeFormat(tag, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat(tag, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
  };
}
