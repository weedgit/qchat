"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

interface Enterprise {
  id: string;
  name: string;
  memberCount: string;
  status: string;
  createdAt: string;
}

function normalize(raw: any): Enterprise {
  return {
    id: String(raw?.id ?? raw?.enterprise_id ?? ""),
    name: String(raw?.name ?? raw?.title ?? ""),
    memberCount: String(raw?.member_count ?? raw?.members ?? "—"),
    status: String(raw?.status ?? "active"),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? ""),
  };
}

export default function EnterprisesPage() {
  const [rows, setRows] = useState<Enterprise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api<any>("/v1/admin/enterprises");
      setRows(asList(body, "enterprises").map(normalize));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell>
      <h1>Enterprises</h1>
      <div className="page-sub">Organizations registered on this server.</div>

      {error && <div className="notice">Failed to load enterprises: {error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Members</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="muted">Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">No enterprises found.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ wordBreak: "break-all" }}>{r.id}</td>
                <td>{r.name}</td>
                <td>{r.memberCount}</td>
                <td>
                  <span className={`pill ${r.status === "active" ? "ok" : "warn"}`}>
                    {r.status}
                  </span>
                </td>
                <td className="muted">{r.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
