"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pagination from "@/components/Pagination";
import { AdminTime } from "@/components/AdminTime";
import { api, asList, mediaAuthURL } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";
import type { MessageKey } from "@qchat/i18n";

import { PAGE_SIZE } from "@/lib/pagination";

const MESSAGE_INSPECT_DEFAULT_REASON = "enterprise_scope";

type MessageScope = "all" | "dm" | "group";

type MessageContentType = "all" | "text" | "image" | "file" | "voice" | "video" | "system" | "call";

const MESSAGE_TYPES: MessageContentType[] = [
  "all",
  "text",
  "image",
  "file",
  "voice",
  "video",
  "system",
  "call",
];

const MESSAGE_TYPE_LABELS: Record<MessageContentType, MessageKey> = {
  all: "admin.messages.typeAll",
  text: "admin.messages.type.text",
  image: "admin.messages.type.image",
  file: "admin.messages.type.file",
  voice: "admin.messages.type.voice",
  video: "admin.messages.type.video",
  system: "admin.messages.type.system",
  call: "admin.messages.type.call",
};

function messageRowClass(type: string, recalled: boolean): string {
  const base = `inspect-row-${(type || "text").toLowerCase()}`;
  return recalled ? `${base} inspect-row-recalled` : base;
}

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

function isVideoFileHint(mediaUrl: string, content: string): boolean {
  const hint = `${mediaUrl} ${content}`.toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogv)(\?|$|#)/i.test(hint);
}

function MediaCell({ m, recalledLabel }: { m: InspectedMessage; recalledLabel: string }) {
  const { t } = useLocale();
  const [mediaFailed, setMediaFailed] = useState(false);
  const hasMedia = Boolean(m.mediaUrl);
  const authUrl = mediaAuthURL(m.mediaUrl);

  useEffect(() => {
    setMediaFailed(false);
  }, [m.id, m.mediaUrl]);

  if (m.recalled && !m.content && !hasMedia) {
    return <span className="muted">{recalledLabel}</span>;
  }

  const showStandaloneText =
    m.content &&
    !(hasMedia && (m.type === "voice" || m.type === "file" || m.type === "image"));

  if (hasMedia && !authUrl) {
    return (
      <div className="inspect-media-cell">
        {showStandaloneText ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
        ) : null}
        <span className="muted">{t("admin.messages.mediaUnavailable")}</span>
      </div>
    );
  }

  if (hasMedia && mediaFailed) {
    return (
      <div className="inspect-media-cell">
        {showStandaloneText ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
        ) : null}
        <span className="muted">{t("admin.messages.mediaUnavailable")}</span>
      </div>
    );
  }

  return (
    <div className="inspect-media-cell">
      {showStandaloneText ? (
        <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
      ) : null}
      {hasMedia && authUrl && m.type === "voice" ? (
        <div className="inspect-media-voice">
          <audio
            className="inspect-media-audio"
            controls
            preload="metadata"
            src={authUrl}
            onError={() => setMediaFailed(true)}
          />
          {m.content ? <div className="muted inspect-media-label">{m.content}</div> : null}
        </div>
      ) : null}
      {hasMedia && authUrl && m.type === "image" ? (
        <div className="inspect-media-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={authUrl}
            alt={m.content || "image"}
            className="inspect-media-img"
            onError={() => setMediaFailed(true)}
          />
          {m.content ? <div className="inspect-media-label">{m.content}</div> : null}
        </div>
      ) : null}
      {hasMedia && authUrl && m.type === "file" ? (
        isVideoFileHint(m.mediaUrl, m.content) ? (
          <div className="inspect-media-video">
            <video
              className="inspect-media-video-el"
              controls
              preload="metadata"
              playsInline
              src={authUrl}
              onError={() => setMediaFailed(true)}
            />
            {m.content ? (
              <a
                className="inspect-media-file"
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                download
              >
                {m.content}
              </a>
            ) : null}
          </div>
        ) : (
          <a
            className="inspect-media-file"
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            download
          >
            {m.content || t("admin.messages.openFile")}
          </a>
        )
      ) : null}
      {hasMedia &&
      authUrl &&
      m.type !== "voice" &&
      m.type !== "image" &&
      m.type !== "file" ? (
        <a
          className="inspect-media-file"
          href={authUrl}
          target="_blank"
          rel="noreferrer"
          download
        >
          {m.content || t("admin.messages.openFile")}
        </a>
      ) : null}
      {!m.content && !hasMedia ? <span className="muted">—</span> : null}
    </div>
  );
}

export default function MessageInspectPage() {
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [user, setUser] = useState("");
  const [groupName, setGroupName] = useState("");
  const [scope, setScope] = useState<MessageScope>("all");
  const [messageType, setMessageType] = useState<MessageContentType>("all");
  const [textQuery, setTextQuery] = useState("");
  const [rows, setRows] = useState<InspectedMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [inspectedUser, setInspectedUser] = useState("");
  const [inspectedGroup, setInspectedGroup] = useState("");
  const [inspectedScope, setInspectedScope] = useState<MessageScope>("all");
  const [inspectedMessageType, setInspectedMessageType] = useState<MessageContentType>("all");
  const [inspectedTextQuery, setInspectedTextQuery] = useState("");

  const loadPage = useCallback(
    async (
      targetUser: string,
      targetGroup: string,
      targetScope: MessageScope,
      targetMessageType: MessageContentType,
      targetText: string,
      from: number
    ) => {
      setBusy(true);
      try {
        const qs = new URLSearchParams({
          scope: targetScope,
          limit: String(PAGE_SIZE),
          offset: String(from),
          reason: MESSAGE_INSPECT_DEFAULT_REASON,
        });
        const trimmedUser = targetUser.trim();
        const trimmedGroup = targetGroup.trim();
        if (trimmedUser) qs.set("user", trimmedUser);
        if (trimmedGroup) qs.set("group", trimmedGroup);
        if (targetMessageType !== "all") {
          qs.set("message_type", targetMessageType);
          qs.set("type", targetMessageType);
        }
        const trimmedText = targetText.trim();
        if (trimmedText) qs.set("text", trimmedText);
        const body = await api<any>(`/v1/admin/messages?${qs.toString()}`);
        setRows(asList(body, "messages").map(normalize));
        setTotal(Number(body?.total ?? 0));
        setOffset(from);
        setInspectedUser(trimmedUser);
        setInspectedGroup(trimmedGroup);
        setInspectedScope(targetScope);
        setInspectedMessageType(targetMessageType);
        setInspectedTextQuery(trimmedText);
      } catch (e: any) {
        toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
        setRows([]);
        setTotal(0);
      } finally {
        setBusy(false);
      }
    },
    [t, toast]
  );

  useEffect(() => {
    void loadPage("", "", "all", "all", "", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function readFormFilters(form: HTMLFormElement) {
    const scopeEl = form.elements.namedItem("scope") as HTMLSelectElement | null;
    const typeEl = form.elements.namedItem("message_type") as HTMLSelectElement | null;
    return {
      scope: (scopeEl?.value ?? "all") as MessageScope,
      messageType: (typeEl?.value ?? "all") as MessageContentType,
    };
  }

  async function inspect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { scope: nextScope, messageType: nextType } = readFormFilters(e.currentTarget);
    setScope(nextScope);
    setMessageType(nextType);
    await loadPage(user, groupName, nextScope, nextType, textQuery, 0);
  }

  function onScopeChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextScope = e.target.value as MessageScope;
    setScope(nextScope);
    void loadPage(user, groupName, nextScope, messageType, textQuery, 0);
  }

  function onMessageTypeChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextType = e.target.value as MessageContentType;
    setMessageType(nextType);
    void loadPage(user, groupName, scope, nextType, textQuery, 0);
  }

  return (
    <AdminShell>

      <form className="toolbar toolbar-full" onSubmit={inspect}>
        <input
          placeholder={t("admin.messages.targetPlaceholder")}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="off"
        />
        <input
          placeholder={t("admin.messages.groupPlaceholder")}
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          autoComplete="off"
        />
        <select
          name="scope"
          value={scope}
          onChange={onScopeChange}
          aria-label={t("admin.common.scope")}
        >
          <option value="all">{t("admin.messages.scopeAll")}</option>
          <option value="dm">{t("admin.messages.scopeDM")}</option>
          <option value="group">{t("admin.messages.scopeGroup")}</option>
        </select>
        <select
          name="message_type"
          value={messageType}
          onChange={onMessageTypeChange}
          aria-label={t("admin.messages.typeFilter")}
        >
          {MESSAGE_TYPES.map((typ) => (
            <option key={typ} value={typ}>
              {t(MESSAGE_TYPE_LABELS[typ])}
            </option>
          ))}
        </select>
        <input
          placeholder={t("admin.messages.textPlaceholder")}
          value={textQuery}
          onChange={(e) => setTextQuery(e.target.value)}
          autoComplete="off"
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t("admin.messages.inspecting") : t("admin.messages.inspect")}
        </button>
      </form>

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
            {busy && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">{t("admin.common.loading")}</td>
              </tr>
            ) : null}
            {!busy && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">{t("admin.messages.noMessagesReturned")}</td>
              </tr>
            ) : null}
            {rows.map((m) => (
              <tr key={m.id} className={messageRowClass(m.type, m.recalled)}>
                <td className="muted">
                  <AdminTime value={m.createdAt} resolved={resolved} />
                </td>
                <td>
                  <div>{m.conversationTitle}</div>
                </td>
                <td className="muted">{m.enterpriseName || "—"}</td>
                <td>
                  <div>{m.senderLabel}</div>
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
          loadPage(
            inspectedUser,
            inspectedGroup,
            inspectedScope,
            inspectedMessageType,
            inspectedTextQuery,
            next
          )
        }
        emptyLabel={t("admin.messages.noMessages")}
      />
    </AdminShell>
  );
}
