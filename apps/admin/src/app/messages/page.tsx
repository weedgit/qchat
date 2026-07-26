"use client";

import { FormEvent, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

const PAGE_SIZE = 50;

interface InspectedMessage {
  id: string;
  conversationId: string;
  conversationTitle: string;
  conversationType: string;
  senderId: string;
  senderLabel: string;
  content: string;
  type: string;
  recalled: boolean;
  createdAt: string;
}

function normalize(raw: any): InspectedMessage {
  const username = String(raw?.sender_username ?? "");
  const display = String(raw?.sender_display_name ?? "");
  const senderId = String(raw?.sender_id ?? raw?.from_user_id ?? raw?.user_id ?? "");
  return {
    id: String(raw?.id ?? raw?.message_id ?? ""),
    conversationId: String(raw?.conversation_id ?? ""),
    conversationTitle: String(raw?.conversation_title ?? "") || "—",
    conversationType: String(raw?.conversation_type ?? ""),
    senderId,
    senderLabel: display || (username ? `@${username}` : senderId) || "—",
    content: String(raw?.content ?? raw?.text ?? raw?.body ?? ""),
    type: String(raw?.type ?? "text"),
    recalled: Boolean(raw?.recalled),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

export default function MessageInspectPage() {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"all" | "sent">("all");
  const [rows, setRows] = useState<InspectedMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectedUserId, setInspectedUserId] = useState("");
  const [inspectedReason, setInspectedReason] = useState("");
  const [inspectedScope, setInspectedScope] = useState<"all" | "sent">("all");

  async function loadPage(
    targetUserId: string,
    targetReason: string,
    targetScope: "all" | "sent",
    from: number
  ) {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        user_id: targetUserId,
        reason: targetReason,
        scope: targetScope,
        limit: String(PAGE_SIZE),
        offset: String(from),
      });
      const body = await api<any>(`/v1/admin/messages?${qs.toString()}`);
      setRows(asList(body, "messages").map(normalize));
      setTotal(Number(body?.total ?? 0));
      setOffset(from);
      setInspectedUserId(targetUserId);
      setInspectedReason(targetReason);
      setInspectedScope(targetScope);
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
    await loadPage(userId.trim(), reason.trim(), scope, 0);
  }

  const from = total === 0 || !rows ? 0 : offset + 1;
  const to = rows ? Math.min(offset + rows.length, total) : 0;

  return (
    <AdminShell>
      <h1>Message inspect</h1>
      <div className="page-sub">
        View the complete chat history for a user within an enterprise (compliance).
      </div>

      <div className="notice">
        Message inspection is a privileged, audited action. Your identity, the
        user ID, scope, and the reason you provide are permanently recorded in the
        audit log for every page viewed. Recalled messages are shown flagged.
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
            <label>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "sent")}>
              <option value="all">All messages in their conversations</option>
              <option value="sent">Only messages they sent</option>
            </select>
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
                  <th>Sender</th>
                  <th>Type</th>
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
                    <td>
                      <div>{m.conversationTitle}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {m.conversationType || "—"} · {m.conversationId || "—"}
                      </div>
                    </td>
                    <td>
                      <div>{m.senderLabel}</div>
                      <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                        {m.senderId}
                      </div>
                    </td>
                    <td className="muted">
                      {m.type}
                      {m.recalled ? " · recalled" : ""}
                    </td>
                    <td style={{ whiteSpace: "pre-wrap" }}>
                      {m.recalled && !m.content ? (
                        <span className="muted">(recalled)</span>
                      ) : (
                        m.content
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="muted">
              {total === 0
                ? "No messages"
                : `Showing ${from}–${to} of ${total} · scope=${inspectedScope}`}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                type="button"
                disabled={busy || offset === 0}
                onClick={() =>
                  loadPage(
                    inspectedUserId,
                    inspectedReason,
                    inspectedScope,
                    Math.max(0, offset - PAGE_SIZE)
                  )
                }
              >
                Previous
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || to >= total}
                onClick={() =>
                  loadPage(inspectedUserId, inspectedReason, inspectedScope, offset + PAGE_SIZE)
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
