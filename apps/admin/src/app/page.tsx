"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import OverviewTrendChart, {
  trendSummaryText,
  type TrendPoint,
  type TrendRangeDays,
} from "@/components/OverviewTrendChart";
import { api, asList, API_URL } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { useLocale } from "@/lib/locale";

type TrendsResponse = {
  days?: number;
  users?: TrendPoint[];
  messages?: TrendPoint[];
  summary?: {
    users_recent?: number;
    users_previous?: number;
    messages_recent?: number;
    messages_previous?: number;
    recent_days?: number;
    previous_days?: number;
  };
};

export default function OverviewPage() {
  const { t } = useLocale();
  const [rangeDays, setRangeDays] = useState<TrendRangeDays>(30);
  const [counts, setCounts] = useState<{
    users?: number;
    enterprises?: number;
    audits?: number;
    groups?: number;
  }>({});
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(true);

  useEffect(() => {
    api<any>("/v1/admin/users?limit=1")
      .then((b) => setCounts((c) => ({ ...c, users: b?.total ?? asList(b, "users").length })))
      .catch(() => {});
    api<any>("/v1/admin/groups?limit=1")
      .then((b) => setCounts((c) => ({ ...c, groups: b?.total ?? asList(b, "groups").length })))
      .catch(() => {});
    api<any>("/v1/admin/enterprises?limit=1")
      .then((b) => setCounts((c) => ({ ...c, enterprises: b?.total ?? asList(b, "enterprises").length })))
      .catch(() => {});
    api<any>("/v1/admin/audits?limit=1")
      .then((b) => setCounts((c) => ({ ...c, audits: b?.total ?? asList(b, "audits", "logs").length })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setTrendsLoading(true);
    api<TrendsResponse>(`/v1/admin/stats/trends?days=${rangeDays}`)
      .then((body) => {
        setTrends(body);
        setTrendsError(null);
      })
      .catch((e) => {
        setTrends(null);
        setTrendsError(formatAdminError(e, t, "admin.overview.trend.loadFailed"));
      })
      .finally(() => setTrendsLoading(false));
  }, [rangeDays]);

  const summary = trends?.summary;
  const recentDays = summary?.recent_days ?? 7;
  const previousDays = summary?.previous_days ?? 7;
  const userTrend = trendSummaryText(
    t,
    t("admin.overview.trend.users"),
    summary?.users_recent ?? 0,
    summary?.users_previous ?? 0,
    recentDays,
    previousDays
  );
  const msgTrend = trendSummaryText(
    t,
    t("admin.overview.trend.messages"),
    summary?.messages_recent ?? 0,
    summary?.messages_previous ?? 0,
    recentDays,
    previousDays
  );

  const trendColor = (dir: "up" | "down" | "flat" | "new") => {
    if (dir === "up") return "#22c55e";
    if (dir === "down") return "#f87171";
    return "var(--text-dim)";
  };

  return (
    <AdminShell>
      <h1>{t("admin.nav.overview")}</h1>
      <div className="page-sub">{t("admin.overview.subtitle", { url: API_URL })}</div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">{counts.users ?? "—"}</div>
          <div className="k">{t("admin.overview.stat.users")}</div>
        </div>
        <div className="stat-card">
          <div className="v">{counts.groups ?? "—"}</div>
          <div className="k">{t("admin.overview.stat.groups")}</div>
        </div>
        <div className="stat-card">
          <div className="v">{counts.enterprises ?? "—"}</div>
          <div className="k">{t("admin.overview.stat.enterprises")}</div>
        </div>
        <div className="stat-card">
          <div className="v">{counts.audits ?? "—"}</div>
          <div className="k">{t("admin.overview.stat.audits")}</div>
        </div>
      </div>

      {trendsError ? <div className="notice" style={{ marginTop: 16 }}>{trendsError}</div> : null}

      <OverviewTrendChart
        users={trends?.users ?? []}
        messages={trends?.messages ?? []}
        loading={trendsLoading}
        rangeDays={rangeDays}
        onRangeChange={setRangeDays}
      />

      {!trendsLoading && trends ? (
        <div className="card" style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, color: trendColor(userTrend.direction) }}>{userTrend.text}</div>
          <div style={{ fontSize: 14, color: trendColor(msgTrend.direction) }}>{msgTrend.text}</div>
        </div>
      ) : null}
    </AdminShell>
  );
}
