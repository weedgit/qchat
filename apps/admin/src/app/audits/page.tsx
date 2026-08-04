"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pagination from "@/components/Pagination";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { useLocale } from "@/lib/locale";

import { PAGE_SIZE } from "@/lib/pagination";
interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  reason: string;
  createdAt: string;
}

function normalize(raw: any): AuditEntry {
  return {
    id: String(raw?.id ?? raw?.audit_id ?? ""),
    actor: String(raw?.actor ?? raw?.admin_id ?? raw?.operator ?? raw?.actor_id ?? ""),
    action: String(raw?.action ?? raw?.event ?? ""),
    target: String(raw?.target ?? raw?.target_id ?? raw?.resource ?? "—"),
    reason: String(raw?.reason ?? "—"),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

export default function AuditsPage() {
  const { t } = useLocale();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        setRows(asList(body, "audits", "logs", "entries").map(normalize));
        setTotal(Number(body?.total ?? 0));
        const list = body?.actions;
        if (Array.isArray(list)) {
          setActions(list.map((a) => String(a)).filter(Boolean));
        }
        setError(null);
      } catch (e: any) {
        setError(formatAdminError(e, t, "admin.err.loadFailed"));
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [t]
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

  return (
    <AdminShell>
      <h1>{t("admin.nav.audits")}</h1>
      <div className="page-sub">{t("admin.audits.subtitle")}</div>

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
              {action}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={loading}>
          {t("admin.common.search")}
        </button>
      </form>

      {error && (
        <div className="notice">
          {t("admin.common.loadFailed", { target: t("admin.audits.loadFailed"), error })}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t("admin.common.time")}</th>
              <th>{t("admin.common.actor")}</th>
              <th>{t("admin.common.action")}</th>
              <th>{t("admin.common.target")}</th>
              <th>{t("admin.common.reason")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="muted">{t("admin.common.loading")}</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">{t("admin.audits.noEntries")}</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.createdAt}</td>
                <td>{r.actor}</td>
                <td>
                  <span className="pill">{r.action}</span>
                </td>
                <td style={{ wordBreak: "break-all" }}>{r.target}</td>
                <td>{r.reason}</td>
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
