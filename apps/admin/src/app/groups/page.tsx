"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

const PAGE_SIZE = 50;

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
      setError(e.message);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(query, offset);
    // Reloads are driven by search submit and paging, not keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, offset]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load(query, 0);
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminShell>
      <h1>Groups</h1>
      <div className="page-sub">
        Social groups in this enterprise — title, public ID, owner, and active member count.
      </div>

      <form className="toolbar" onSubmit={onSearch} style={{ marginBottom: 16 }}>
        <input
          placeholder="Search title or public ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <button type="submit" disabled={loading}>
          Search
        </button>
      </form>

      {error && <div className="notice">Failed to load groups: {error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Title</th>
              <th>Public ID</th>
              <th>Owner</th>
              <th>Members</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No groups found.
                </td>
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

      <div className="toolbar" style={{ marginTop: 12, gap: 8 }}>
        <span className="muted">
          {total} group{total === 1 ? "" : "s"} · page {page} / {pages}
        </span>
        <button
          type="button"
          disabled={loading || offset <= 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={loading || offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </AdminShell>
  );
}
