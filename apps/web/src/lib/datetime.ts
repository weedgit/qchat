import { intlLocale, type ResolvedLocale } from "@qchat/i18n";

/** Conversation / message timestamps (today → time; else short month+day). */
export function formatConversationTime(
  iso: string | undefined,
  locale: ResolvedLocale
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tag = intlLocale(locale);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(tag, { month: "short", day: "numeric" });
}

/** Short month+day for last-seen and similar labels. */
export function formatShortDate(iso: string | Date, locale: ResolvedLocale): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(intlLocale(locale), {
    month: "short",
    day: "numeric",
  });
}
