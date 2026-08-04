"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { api } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { translateRole } from "@/lib/labels";
import { useLocale } from "@/lib/locale";

type Me = {
  phone?: string;
  username?: string;
  display_name?: string;
  role?: string;
  enterprise_name?: string;
  mfa_active?: boolean;
};

export default function ProfilePage() {
  const { t } = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Me>("/v1/me")
      .then((body) => {
        setMe(body);
        setError(null);
      })
      .catch((e) => setError(formatAdminError(e, t, "admin.err.loadFailed")))
      .finally(() => setLoading(false));
  }, [t]);

  const role = String(me?.role ?? "");
  const label = role ? translateRole(t, role) : "—";

  return (
    <AdminShell>
      <h1>{t("admin.nav.profile")}</h1>
      <div className="page-sub">{t("admin.profile.subtitle")}</div>

      {error ? <div className="notice">{error}</div> : null}

      <div className="card" style={{ maxWidth: 480 }}>
        {loading ? (
          <p className="muted">{t("admin.common.loading")}</p>
        ) : (
          <dl className="profile-dl">
            <div className="profile-row">
              <dt>{t("admin.common.role")}</dt>
              <dd>{label}</dd>
            </div>
            <div className="profile-row">
              <dt>{t("admin.profile.displayName")}</dt>
              <dd>{me?.display_name || "—"}</dd>
            </div>
            <div className="profile-row">
              <dt>{t("admin.common.username")}</dt>
              <dd>{me?.username ? `@${me.username}` : "—"}</dd>
            </div>
            <div className="profile-row">
              <dt>{t("admin.common.phone")}</dt>
              <dd>{me?.phone || "—"}</dd>
            </div>
            <div className="profile-row">
              <dt>{t("admin.profile.enterprise")}</dt>
              <dd>{me?.enterprise_name || "—"}</dd>
            </div>
            <div className="profile-row">
              <dt>{t("admin.profile.mfa")}</dt>
              <dd>{me?.mfa_active ? t("admin.profile.mfaOn") : t("admin.profile.mfaOff")}</dd>
            </div>
          </dl>
        )}
        <p style={{ marginTop: 16, marginBottom: 0 }}>
          <Link href="/security">{t("admin.profile.securityLink")}</Link>
        </p>
      </div>
    </AdminShell>
  );
}
