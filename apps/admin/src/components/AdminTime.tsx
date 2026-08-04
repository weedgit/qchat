"use client";

import type { ResolvedLocale } from "@qchat/i18n";
import { formatAdminDateParts } from "@/lib/formatTime";

export function AdminTime({
  value,
  resolved,
  className,
}: {
  value: string | null | undefined;
  resolved: ResolvedLocale;
  className?: string;
}) {
  const raw = value?.trim() ?? "";
  const parts = formatAdminDateParts(value, resolved);
  if (!raw) {
    return <span className={className}>—</span>;
  }
  if (!parts) {
    return <span className={className}>{raw}</span>;
  }
  return (
    <time
      className={["admin-time-stack", className].filter(Boolean).join(" ")}
      dateTime={raw}
      title={raw}
    >
      <span className="admin-time-date">{parts.date}</span>
      <span className="admin-time-clock">{parts.time}</span>
    </time>
  );
}
