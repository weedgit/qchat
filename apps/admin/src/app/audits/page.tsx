"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

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
    actor: String(raw?.actor ?? raw?.admin_id ?? raw?.operator ?? ""),
    action: String(raw?.action ?? raw?.event ?? ""),
    target: String(raw?.target ?? raw?.target_id ?? raw?.resource ?? "—"),
    reason: String(raw?.reason ?? "—"),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

export default function AuditsPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api<any>("/v1/admin/audits");
      setRows(asList(body, "audits", "logs", "entries").map(normalize));
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
      <h1>Audit log</h1>
      <div className="page-sub">
        Administrative actions, including message inspections and their reasons.
      </div>

      {error && <div className="notice">Failed to load audit log: {error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
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
                <td colSpan={5} className="muted">No audit entries.</td>
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
    </AdminShell>
  );
}
