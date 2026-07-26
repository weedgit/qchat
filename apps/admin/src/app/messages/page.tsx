"use client";

import { FormEvent, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

const PAGE_SIZE = 50;

interface InspectedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

function normalize(raw: any): InspectedMessage {
  return {
    id: String(raw?.id ?? raw?.message_id ?? ""),
    conversationId: String(raw?.conversation_id ?? ""),
    senderId: String(raw?.sender_id ?? raw?.from_user_id ?? raw?.user_id ?? ""),
    content: String(raw?.content ?? raw?.text ?? raw?.body ?? ""),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

export default function MessageInspectPage() {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<InspectedMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectedUserId, setInspectedUserId] = useState("");
  const [inspectedReason, setInspectedReason] = useState("");

  async function loadPage(targetUserId: string, targetReason: string, from: number) {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        user_id: targetUserId,
        reason: targetReason,
        limit: String(PAGE_SIZE),
        offset: String(from),
      });
      const body = await api<any>(`/v1/admin/messages?${qs.toString()}`);
      setRows(asList(body, "messages").map(normalize));
      setTotal(Number(body?.total ?? 0));
      setOffset(from);
      setInspectedUserId(targetUserId);
      setInspectedReason(targetReason);
    } catch (e: any) {
      setError(e.message);
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function inspect(e: FormEvent) {
    e.preventDefault();
    if (!userId.trim()) {
      setError("A user ID is required.");
      return;
    }
    if (reason.trim().length < 8) {
      setError("A meaningful reason (at least 8 characters) is required.");
      return;
    }
    await loadPage(userId.trim(), reason.trim(), 0);
  }

  const from = total === 0 || !rows ? 0 : offset + 1;
  const to = rows ? Math.min(offset + rows.length, total) : 0;

  return (
    <AdminShell>
      <h1>Message inspect</h1>
      <div className="page-sub">
        View the messages sent by a specific user for compliance purposes.
      </div>

      <div className="notice">
        Message inspection is a privileged, audited action. Your identity, the
        user ID and the reason you provide are permanently recorded in the audit
        log for every page viewed.
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <form onSubmit={inspect} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label>User ID</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="e.g. 8f2c9a…"
              required
            />
          </div>
          <div className="field">
            <label>Reason (required, recorded in audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Compliance ticket #1234 — reported harassment"
              rows={3}
              required
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn" disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? "Inspecting…" : "Inspect messages"}
          </button>
        </form>
      </div>

      {rows && (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Conversation</th>
                  <th>Message ID</th>
                  <th>Sender</th>
                  <th>Content</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No messages returned.</td>
                  </tr>
                )}
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{m.createdAt}</td>
                    <td style={{ wordBreak: "break-all" }}>{m.conversationId || "—"}</td>
                    <td style={{ wordBreak: "break-all" }}>{m.id}</td>
                    <td style={{ wordBreak: "break-all" }}>{m.senderId}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{m.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="muted">
              {total === 0 ? "No messages" : `Showing ${from}–${to} of ${total}`}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                type="button"
                disabled={busy || offset === 0}
                onClick={() =>
                  loadPage(inspectedUserId, inspectedReason, Math.max(0, offset - PAGE_SIZE))
                }
              >
                Previous
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || to >= total}
                onClick={() =>
                  loadPage(inspectedUserId, inspectedReason, offset + PAGE_SIZE)
                }
              >
                Next
              </button>
            </span>
          </div>
        </>
      )}
    </AdminShell>
  );
}
