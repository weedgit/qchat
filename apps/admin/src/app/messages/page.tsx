"use client";

import { FormEvent, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

interface InspectedMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

function normalize(raw: any): InspectedMessage {
  return {
    id: String(raw?.id ?? raw?.message_id ?? ""),
    senderId: String(raw?.sender_id ?? raw?.from_user_id ?? raw?.user_id ?? ""),
    content: String(raw?.content ?? raw?.text ?? raw?.body ?? ""),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

export default function MessageInspectPage() {
  const [conversationId, setConversationId] = useState("");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<InspectedMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function inspect(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setError("A meaningful reason (at least 5 characters) is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const qs = new URLSearchParams({
        conversation_id: conversationId.trim(),
        reason: reason.trim(),
      });
      const body = await api<any>(`/v1/admin/messages?${qs.toString()}`);
      setRows(asList(body, "messages").map(normalize));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1>Message inspect</h1>
      <div className="page-sub">
        View messages of a conversation for compliance purposes.
      </div>

      <div className="notice">
        Message inspection is a privileged, audited action. Your identity, the
        conversation ID and the reason you provide are permanently recorded in
        the audit log.
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <form onSubmit={inspect} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label>Conversation ID</label>
            <input
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
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
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Message ID</th>
                <th>Sender</th>
                <th>Content</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">No messages returned.</td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="muted">{m.createdAt}</td>
                  <td style={{ wordBreak: "break-all" }}>{m.id}</td>
                  <td style={{ wordBreak: "break-all" }}>{m.senderId}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{m.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
