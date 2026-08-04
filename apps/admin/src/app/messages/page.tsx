"use client";

import { FormEvent, useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pagination from "@/components/Pagination";
import { api, asList, mediaAuthURL } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { useLocale } from "@/lib/locale";

import { PAGE_SIZE } from "@/lib/pagination";
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

function MediaCell({ m, recalledLabel }: { m: InspectedMessage; recalledLabel: string }) {
  if (m.recalled && !m.content && !m.mediaUrl) {
    return <span className="muted">{recalledLabel}</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
      {m.content ? <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div> : null}
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
  const { t } = useLocale();
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
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function inspect(e: FormEvent) {
    e.preventDefault();
    if (!user.trim()) {
      setError(t("admin.err.targetRequired"));
      return;
    }
    if (reason.trim().length < 8) {
      setError(t("admin.err.reasonRequired"));
      return;
    }
    await loadPage(user.trim(), reason.trim(), scope, 0);
  }

  return (
    <AdminShell>
      <h1>{t("admin.nav.messages")}</h1>
      <div className="page-sub">{t("admin.messages.subtitle")}</div>

      <div className="notice">{t("admin.messages.notice")}</div>

      <div className="card" style={{ maxWidth: 720 }}>
        <form onSubmit={inspect} className="form-rows" style={{ maxWidth: "100%" }}>
          <div className="form-row">
            <label htmlFor="msg-inspect-user">{t("admin.messages.targetLabel")}</label>
            <input
              id="msg-inspect-user"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder={t("admin.messages.targetPlaceholder")}
              required
              autoComplete="off"
            />
          </div>
          <div className="form-row">
            <label htmlFor="msg-inspect-scope">{t("admin.common.scope")}</label>
            <select
              id="msg-inspect-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as "all" | "sent")}
            >
              <option value="all">{t("admin.messages.scopeAll")}</option>
              <option value="sent">{t("admin.messages.scopeSent")}</option>
            </select>
          </div>
          <div className="form-row" style={{ alignItems: "start" }}>
            <label htmlFor="msg-inspect-reason">{t("admin.common.reason")}</label>
            <div className="form-control-stack">
              <textarea
                id="msg-inspect-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("admin.messages.reasonPlaceholder")}
                rows={3}
                required
              />
              {error ? <div className="error-text">{error}</div> : null}
            </div>
          </div>
          <div className="form-row">
            <span />
            <button className="btn" disabled={busy} style={{ alignSelf: "flex-start" }}>
              {busy ? t("admin.messages.inspecting") : t("admin.messages.inspect")}
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
                  <th>{t("admin.common.time")}</th>
                  <th>{t("admin.messages.conversation")}</th>
                  <th>{t("admin.messages.company")}</th>
                  <th>{t("admin.messages.sender")}</th>
                  <th>{t("admin.common.type")}</th>
                  <th>{t("admin.common.content")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">{t("admin.messages.noMessagesReturned")}</td>
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
                      {m.recalled ? t("admin.common.recalledSuffix") : ""}
                    </td>
                    <td>
                      <MediaCell m={m} recalledLabel={t("admin.common.recalled")} />
                    </td>
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
            loading={busy}
            onPageChange={(next) =>
              loadPage(inspectedUser, inspectedReason, inspectedScope, next)
            }
            emptyLabel={t("admin.messages.noMessages")}
          />
        </>
      )}
    </AdminShell>
  );
}
