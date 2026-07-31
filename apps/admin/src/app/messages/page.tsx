"use client";

import { FormEvent, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList, mediaAuthURL } from "@/lib/api";

const PAGE_SIZE = 50;

interface InspectedMessage {
  id: string;
  conversationId: string;
  conversationTitle: string;
  conversationType: string;
  enterpriseName: string;
  senderId: string;
  senderLabel: string;
  content: string;
  type: string;
  mediaUrl: string;
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
    enterpriseName: String(raw?.enterprise_name ?? "").trim(),
    senderId,
    senderLabel: display || (username ? `@${username}` : senderId) || "—",
    content: String(raw?.content ?? raw?.text ?? raw?.body ?? ""),
    type: String(raw?.type ?? "text"),
    mediaUrl: String(raw?.media_url ?? raw?.mediaUrl ?? "").trim(),
    recalled: Boolean(raw?.recalled),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp ?? ""),
  };
}

function MediaCell({ m }: { m: InspectedMessage }) {
  if (m.recalled && !m.content && !m.mediaUrl) {
    return <span className="muted">(recalled)</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
      {m.content ? (
        <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
      ) : null}
      {m.mediaUrl ? (
        <div>
          {m.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaAuthURL(m.mediaUrl) || m.mediaUrl}
              alt={m.content || "image"}
              style={{
                maxWidth: 220,
                maxHeight: 160,
                borderRadius: 8,
                objectFit: "contain",
                background: "#0f172a",
              }}
            />
          ) : null}
          <a
            href={mediaAuthURL(m.mediaUrl) || m.mediaUrl}
            target="_blank"
            rel="noreferrer"
            download
            style={{ fontSize: 12, wordBreak: "break-all" }}
          >
            {m.mediaUrl}
          </a>
        </div>
      ) : null}
      {!m.content && !m.mediaUrl ? <span className="muted">—</span> : null}
    </div>
  );
}

export default function MessageInspectPage() {
  const [user, setUser] = useState("");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"all" | "sent">("all");
  const [rows, setRows] = useState<InspectedMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectedUser, setInspectedUser] = useState("");
  const [inspectedReason, setInspectedReason] = useState("");
  const [inspectedScope, setInspectedScope] = useState<"all" | "sent">("all");

  async function loadPage(
    targetUser: string,
    targetReason: string,
    targetScope: "all" | "sent",
    from: number
  ) {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        user: targetUser,
        reason: targetReason,
        scope: targetScope,
        limit: String(PAGE_SIZE),
        offset: String(from),
      });
      const body = await api<any>(`/v1/admin/messages?${qs.toString()}`);
      setRows(asList(body, "messages").map(normalize));
      setTotal(Number(body?.total ?? 0));
      setOffset(from);
      setInspectedUser(targetUser);
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
    if (!user.trim()) {
      setError("Username or phone number is required.");
      return;
    }
    if (reason.trim().length < 8) {
      setError("A meaningful reason (at least 8 characters) is required.");
      return;
    }
    await loadPage(user.trim(), reason.trim(), scope, 0);
  }

  const from = total === 0 || !rows ? 0 : offset + 1;
  const to = rows ? Math.min(offset + rows.length, total) : 0;

  return (
    <AdminShell>
      <h1>Message inspect</h1>
      <div className="page-sub">
        View membership-scoped chat history for a user in your enterprise (compliance).
        Includes messages from shared groups even when senders belong to another tenant.
      </div>

      <div className="notice">
        Message inspection is a privileged, audited action. Your identity, the
        target user, scope, and the reason you provide are permanently recorded in the
        audit log for every page viewed. Recalled messages are shown flagged.
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <form onSubmit={inspect} className="form-rows" style={{ maxWidth: "100%" }}>
          <div className="form-row">
            <label htmlFor="msg-inspect-user">Username or phone</label>
            <input
              id="msg-inspect-user"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="e.g. alice or 13800138000"
              required
              autoComplete="off"
            />
          </div>
          <div className="form-row">
            <label htmlFor="msg-inspect-scope">Scope</label>
            <select
              id="msg-inspect-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as "all" | "sent")}
            >
              <option value="all">All messages in their conversations</option>
              <option value="sent">Only messages they sent</option>
            </select>
          </div>
          <div className="form-row" style={{ alignItems: "start" }}>
            <label htmlFor="msg-inspect-reason">Reason</label>
            <div className="form-control-stack">
              <textarea
                id="msg-inspect-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Compliance ticket #1234 — reported harassment"
                rows={3}
                required
              />
              {error ? <div className="error-text">{error}</div> : null}
            </div>
          </div>
          <div className="form-row">
            <span />
            <button className="btn" disabled={busy} style={{ alignSelf: "flex-start" }}>
              {busy ? "Inspecting…" : "Inspect messages"}
            </button>
          </div>
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
                  <th>Company</th>
                  <th>Sender</th>
                  <th>Type</th>
                  <th>Content</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">No messages returned.</td>
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
                    <td className="muted">{m.enterpriseName || "—"}</td>
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
                    <td>
                      <MediaCell m={m} />
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
                    inspectedUser,
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
                  loadPage(inspectedUser, inspectedReason, inspectedScope, offset + PAGE_SIZE)
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
