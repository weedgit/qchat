"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

interface Enterprise {
  id: string;
  name: string;
  inviteCode: string;
  inviteActive: boolean;
  retentionDays: number;
  createdAt: string;
}

function normalize(raw: any): Enterprise {
  return {
    id: String(raw?.id ?? raw?.enterprise_id ?? ""),
    name: String(raw?.name ?? raw?.title ?? ""),
    inviteCode: String(raw?.invite_code ?? ""),
    inviteActive: Boolean(raw?.invite_active ?? false),
    retentionDays: Number(raw?.retention_days ?? 90),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? ""),
  };
}

export default function EnterprisesPage() {
  const [rows, setRows] = useState<Enterprise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api<any>("/v1/admin/enterprises");
      const list = asList(body, "enterprises").map(normalize);
      setRows(list);
      const drafts: Record<string, string> = {};
      for (const e of list) drafts[e.id] = String(e.retentionDays);
      setRetentionDraft(drafts);
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

  async function rotateInvite() {
    setBusy("rotate");
    setNotice(null);
    try {
      const body = await api<any>("/v1/admin/invite/rotate", { method: "POST", body: "{}" });
      setNotice(`Invite rotated to ${body?.invite_code}`);
      await load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function setInviteActive(active: boolean) {
    setBusy(active ? "activate" : "revoke");
    setNotice(null);
    try {
      await api(`/v1/admin/invite/${active ? "activate" : "revoke"}`, {
        method: "POST",
        body: "{}",
      });
      setNotice(active ? "Invite activated." : "Invite revoked.");
      await load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function saveRetention(id: string) {
    setBusy(`retention-${id}`);
    setNotice(null);
    try {
      const days = Number(retentionDraft[id] ?? 90);
      await api(`/v1/admin/enterprises/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ retention_days: days }),
      });
      setNotice(`Retention set to ${days} days.`);
      await load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function runRetention() {
    setBusy("run-retention");
    setNotice(null);
    try {
      const body = await api<any>("/v1/admin/retention/run", { method: "POST", body: "{}" });
      setNotice(`Retention job deleted ${body?.deleted ?? 0} messages.`);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <h1>Enterprises</h1>
      <div className="page-sub">
 Organizations, invite codes, and 90-day history retention (DataRetention).
      </div>

      <div className="toolbar">
        <button className="btn" type="button" disabled={!!busy} onClick={rotateInvite}>
          {busy === "rotate" ? "Rotating…" : "Rotate invite"}
        </button>
        <button className="btn" type="button" disabled={!!busy} onClick={() => setInviteActive(false)}>
          {busy === "revoke" ? "Revoking…" : "Revoke invite"}
        </button>
        <button className="btn" type="button" disabled={!!busy} onClick={() => setInviteActive(true)}>
          {busy === "activate" ? "Activating…" : "Activate invite"}
        </button>
        <button className="btn" type="button" disabled={!!busy} onClick={runRetention}>
          {busy === "run-retention" ? "Running…" : "Run retention now"}
        </button>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="notice">Failed to load enterprises: {error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Invite code</th>
              <th>Invite</th>
              <th>Retention (days)</th>
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
                <td>{r.name}</td>
                <td style={{ fontFamily: "monospace" }}>{r.inviteCode}</td>
                <td>
                  <span className={`pill ${r.inviteActive ? "ok" : "warn"}`}>
                    {r.inviteActive ? "active" : "revoked"}
                  </span>
                </td>
                <td>
                  <div className="toolbar" style={{ gap: 6, margin: 0 }}>
                    <input
                      style={{ width: 72 }}
                      value={retentionDraft[r.id] ?? String(r.retentionDays)}
                      onChange={(e) =>
                        setRetentionDraft((d) => ({ ...d, [r.id]: e.target.value }))
                      }
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={busy === `retention-${r.id}`}
                      onClick={() => saveRetention(r.id)}
                    >
                      Save
                    </button>
                  </div>
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
