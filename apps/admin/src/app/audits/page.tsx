"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AdminTime } from "@/components/AdminTime";
import Pagination from "@/components/Pagination";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { auditActionLabel, userLogPlatformLabel } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { can } from "@/lib/rbac";
import { useToast } from "@/components/Toast";
import type { MessageKey } from "@qchat/i18n";

import { PAGE_SIZE } from "@/lib/pagination";

const RETENTION_LABELS: Record<number, MessageKey> = {
  90: "admin.userLog.retention3m",
  180: "admin.userLog.retention6m",
  365: "admin.userLog.retention1y",
};

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  platform: string;
  ip: string;
  location: string;
  createdAt: string;
}

function normalize(raw: any): AuditEntry {
  return {
    id: String(raw?.id ?? raw?.audit_id ?? ""),
    actor: String(raw?.actor ?? raw?.admin_id ?? raw?.operator ?? raw?.actor_id ?? ""),
    action: String(raw?.action ?? raw?.event ?? ""),
    platform: String(raw?.platform ?? ""),
    ip: String(raw?.ip ?? "") || "—",
    location: String(raw?.location ?? "") || "—",
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

export default function AuditsPage() {
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [meRole, setMeRole] = useState("");
  const [retentionDays, setRetentionDays] = useState(90);
  const [retentionOptions, setRetentionOptions] = useState<number[]>([90, 180, 365]);
  const [retentionBusy, setRetentionBusy] = useState(false);

  const canSetRetention = can(meRole, "writeEnterprise");

  useEffect(() => {
    api<any>("/v1/me")
      .then((me) => setMeRole(String(me?.role ?? "")))
      .catch(() => {});
    api<any>("/v1/admin/user-log/settings")
      .then((body) => {
        const days = Number(body?.retention_days ?? 90);
        setRetentionDays(days);
        const opts = body?.options;
        if (Array.isArray(opts) && opts.length > 0) {
          setRetentionOptions(opts.map((n: number) => Number(n)).filter((n: number) => n > 0));
        }
      })
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (q: string, action: string, off: number) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(off),
        });
        if (q.trim()) qs.set("q", q.trim());
        if (action) qs.set("action", action);
        const body = await api<any>(`/v1/admin/audits?${qs.toString()}`);
        setRows(asList(body, "logs", "audits", "entries").map(normalize));
        setTotal(Number(body?.total ?? 0));
        const list = body?.actions;
        if (Array.isArray(list)) {
          setActions(list.map((a) => String(a)).filter(Boolean));
        }
      } catch (e: any) {
        toast.error(
          t("admin.common.loadFailed", {
            target: t("admin.audits.loadFailed"),
            error: formatAdminError(e, t, "admin.err.loadFailed"),
          })
        );
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [t, toast]
  );

  useEffect(() => {
    load(query, actionFilter, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, offset]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load(query, actionFilter, 0);
  }

  function onActionChange(value: string) {
    setActionFilter(value);
    setOffset(0);
    void load(query, value, 0);
  }

  async function onRetentionChange(days: number) {
    if (!canSetRetention || retentionBusy || days === retentionDays) return;
    setRetentionBusy(true);
    try {
      const body = await api<any>("/v1/admin/user-log/settings", {
        method: "PATCH",
        body: JSON.stringify({ retention_days: days }),
      });
      setRetentionDays(Number(body?.retention_days ?? days));
      toast.success(t("admin.userLog.retentionSaved"));
    } catch {
      toast.error(t("admin.userLog.retentionFailed"));
    } finally {
      setRetentionBusy(false);
    }
  }

  return (
    <AdminShell>
      <form className="toolbar toolbar-full" onSubmit={onSearch} style={{ marginBottom: 16 }}>
        <input
          placeholder={t("admin.audits.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          value={actionFilter}
          onChange={(e) => onActionChange(e.target.value)}
          aria-label={t("admin.audits.filterAction")}
        >
          <option value="">{t("admin.audits.filterAll")}</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {auditActionLabel(t, action)}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={loading}>
          {t("admin.common.search")}
        </button>
        {canSetRetention ? (
          <>
            <label className="toolbar-label" htmlFor="user-log-retention">
              {t("admin.userLog.retentionLabel")}
            </label>
            <select
              id="user-log-retention"
              className="user-log-retention-select"
              value={retentionDays}
              disabled={retentionBusy}
              onChange={(e) => onRetentionChange(Number(e.target.value))}
              aria-label={t("admin.userLog.retentionLabel")}
            >
              {retentionOptions.map((days) => (
                <option key={days} value={days}>
                  {t(RETENTION_LABELS[days] ?? "admin.userLog.retention3m")}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </form>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t("admin.common.time")}</th>
              <th>{t("admin.common.actor")}</th>
              <th>{t("admin.common.action")}</th>
              <th>{t("admin.common.platform")}</th>
              <th>{t("admin.common.ip")}</th>
              <th>{t("admin.common.location")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="muted">{t("admin.common.loading")}</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">{t("admin.audits.noEntries")}</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">
                  <AdminTime value={r.createdAt} resolved={resolved} />
                </td>
                <td>{r.actor}</td>
                <td>{auditActionLabel(t, r.action)}</td>
                <td>
                  <span className="pill">
                    {userLogPlatformLabel(t, r.platform)}
                  </span>
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 16 }}>{r.ip}</td>
                <td className="muted">{r.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        total={total}
        offset={offset}
        pageSize={PAGE_SIZE}
        visibleCount={rows.length}
        loading={loading}
        onPageChange={setOffset}
        emptyLabel={t("admin.audits.noEntries")}
      />
    </AdminShell>
  );
}
