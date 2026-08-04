"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pagination from "@/components/Pagination";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { useLocale } from "@/lib/locale";

import { PAGE_SIZE } from "@/lib/pagination";
interface AdminGroup {
  id: string;
  publicId: string;
  title: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  createdAt: string;
}

function normalize(raw: any): AdminGroup {
  return {
    id: String(raw?.id ?? ""),
    publicId: String(raw?.public_id ?? ""),
    title: String(raw?.title ?? ""),
    ownerId: String(raw?.owner_id ?? ""),
    ownerName: String(raw?.owner_display_name ?? ""),
    memberCount: Number(raw?.member_count ?? 0),
    createdAt: String(raw?.created_at ?? ""),
  };
}

export default function GroupsPage() {
  const { t } = useLocale();
  const [rows, setRows] = useState<AdminGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q: string, off: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(off),
      });
      if (q.trim()) qs.set("q", q.trim());
      const body = await api<any>(`/v1/admin/groups?${qs.toString()}`);
      setRows(asList(body, "groups").map(normalize).filter((g: AdminGroup) => g.id));
      setTotal(Number(body?.total ?? 0));
      setError(null);
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load(query, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, offset]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load(query, 0);
  }

  return (
    <AdminShell>
      <h1>{t("admin.nav.groups")}</h1>
      <div className="page-sub">{t("admin.groups.subtitle")}</div>

      <form className="toolbar toolbar-full" onSubmit={onSearch} style={{ marginBottom: 16 }}>
        <input
          placeholder={t("admin.groups.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {t("admin.common.search")}
        </button>
      </form>

      {error && (
        <div className="notice">
          {t("admin.common.loadFailed", { target: t("admin.groups.loadFailed"), error })}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t("admin.common.title")}</th>
              <th>{t("admin.common.publicId")}</th>
              <th>{t("admin.common.owner")}</th>
              <th>{t("admin.common.members")}</th>
              <th>{t("admin.common.created")}</th>
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
                <td colSpan={5} className="muted">{t("admin.groups.noGroupsFound")}</td>
              </tr>
            )}
            {rows.map((g) => (
              <tr key={g.id}>
                <td>
                  <div>{g.title || "—"}</div>
                  <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                    {g.id}
                  </div>
                </td>
                <td>
                  <code>{g.publicId || "—"}</code>
                </td>
                <td>
                  <div>{g.ownerName || "—"}</div>
                  <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                    {g.ownerId || ""}
                  </div>
                </td>
                <td>{g.memberCount}</td>
                <td className="muted">{g.createdAt}</td>
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
        emptyLabel={t("admin.groups.noGroupsFound")}
      />
    </AdminShell>
  );
}
