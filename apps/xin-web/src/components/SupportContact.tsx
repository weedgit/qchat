"use client";

import type { MessageKey } from "@qchat/i18n";
import { getPlatformSupport } from "@/lib/support";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function PlatformSupportBlock({
  t,
  className = "auth-support muted",
}: {
  t: Translate;
  className?: string;
}) {
  const support = getPlatformSupport();
  if (!support) return null;

  return (
    <p className={className}>
      <span>{t("support.needCompanyAccount")} </span>
      {support.url ? (
        <a
          href={support.url}
          className="auth-support-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("support.contactUs")}
        </a>
      ) : null}
      {support.url && support.email ? <span> · </span> : null}
      {support.email ? (
        <a href={`mailto:${support.email}`} className="auth-support-link">
          {support.email}
        </a>
      ) : null}
    </p>
  );
}

export function EnterpriseSupportBlock({
  t,
  email,
  phone,
  className = "auth-support muted",
}: {
  t: Translate;
  email?: string;
  phone?: string;
  className?: string;
}) {
  const e = (email || "").trim();
  const p = (phone || "").trim();
  if (!e && !p) return null;

  return (
    <div className={className} style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, marginBottom: 4 }}>{t("support.enterpriseContact")}</div>
      {e ? (
        <div>
          {t("support.enterpriseEmail")}:{" "}
          <a href={`mailto:${e}`} className="auth-support-link">{e}</a>
        </div>
      ) : null}
      {p ? (
        <div>
          {t("support.enterprisePhone")}:{" "}
          <a href={`tel:${p.replace(/\s/g, "")}`} className="auth-support-link">{p}</a>
        </div>
      ) : null}
    </div>
  );
}
