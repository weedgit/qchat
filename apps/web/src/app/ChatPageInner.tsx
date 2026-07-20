"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import CallOverlay from "@/components/CallOverlay";
import FriendNoteEditor from "@/components/FriendNoteEditor";
import GroupQr from "@/components/GroupQr";
import MessageBody from "@/components/MessageBody";
import { api, clearToken, mediaAuthURL } from "@/lib/api";
import { formatTypingLabel, useChat, type TypingUser } from "@/lib/useChat";
import { useCall } from "@/lib/useCall";
import { Conversation, Message, conversationDisplayName, formatLastSeen } from "@/lib/types";
import { useTheme } from "@/lib/theme";
import { useGlobalSearch } from "@/lib/useSearch";
import { getDraft, saveDraft } from "@/lib/drafts";

const VOICE_MAX_SEC = 60;

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ConversationRow({
  conv,
  active,
  typing,
  online,
  onClick,
  onFavorite,
  onMute,
  onMarkUnread,
}: {
  conv: Conversation;
  active: boolean;
  typing: TypingUser[];
  online?: boolean;
  onClick: () => void;
  onFavorite: () => void;
  onMute: () => void;
  onMarkUnread: () => void;
}) {
  const typingLabel = formatTypingLabel(typing);
  const isDM = conv.type === "dm";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  return (
    <div
      className={`conv-item ${active ? "active" : ""} ${conv.muted ? "muted-conv" : ""} ${
        conv.favorite ? "favorited" : ""
      }`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <Avatar
        name={conversationDisplayName(conv)}
        url={conv.avatarUrl}
        size={50}
        showStatus={isDM}
        online={online}
      />
      <div className="conv-body">
        <div className="conv-top">
          <span className="conv-title">
            {conv.favorite ? <span className="fav-mark" title="Favorite">★ </span> : null}
            {conversationDisplayName(conv)}
            {conv.muted ? <span className="mute-mark" title="Muted"> · muted</span> : null}
          </span>
          <span className="conv-time">{fmtTime(conv.lastMessageAt)}</span>
        </div>
        <div className="conv-bottom">
          <span className={`conv-preview ${typingLabel ? "typing" : ""}`}>
            {typingLabel ? (
              typingLabel
            ) : conv.lastMessage ? (
              <>
                {(conv.lastMessageMine || conv.type !== "dm") && conv.lastMessageSender && (
                  <span className="conv-sender">
                    {conv.lastMessageMine ? "You" : conv.lastMessageSender}:{" "}
                  </span>
                )}
                {conv.lastMessage}
              </>
            ) : (
              <span className="muted">No messages yet</span>
            )}
          </span>
          {conv.unreadCount > 0 && (
            <span className={`badge ${conv.muted ? "muted-badge" : ""} ${conv.mentionCount ? "mention-badge" : ""}`}>
              {conv.mentionCount ? "@" : ""}
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
      {menu && (
        <div
          className="ctx-menu conv-ctx"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              onFavorite();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.pin} />
            {conv.favorite ? "Unfavorite" : "Favorite"}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              onMute();
              setMenu(null);
            }}
          >
            <MenuIcon d={conv.muted ? ICONS.unmute : ICONS.mute} />
            {conv.muted ? "Unmute" : "Mute"}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              onMarkUnread();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.markUnread} />
            Mark as unread
          </button>
        </div>
      )}
    </div>
  );
}

function receiptMark(msg: Message): string {
  // JD / WeChat-style: ⏳ sending → ✓ sent/delivered → ✓✓ read
  if (msg.pending) return " \u23F3";
  if (msg.failed) return " !";
  if (!msg.mine || msg.recalled) return "";
  if (msg.read) return " \u2713\u2713";
  return " \u2713";
}

function MenuIcon({ d, style }: { d: string; style?: CSSProperties }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  reply: "M9 17l-5-5 5-5 M4 12h9a6 6 0 0 1 6 6v1",
  copy: "M9 9h10v12H9z M5 15V3h10",
  forward: "M15 7l5 5-5 5 M20 12h-9a6 6 0 0 0-6 6v1",
  select: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 12l2.5 2.5 4.5-4.5",
  trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  retry: "M3 12a9 9 0 1 0 3-6.7 M6 2v4h4",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  pencil: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 11a7 7 0 0 1-14 0 M12 18v4",
  stop: "M6 6h12v12H6z",
  paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  pin: "M12 17v5 M9 10.76V3h6v7.76L19 14v1H5v-1l4-3.24z",
  mute: "M11 5L6 9H2v6h4l5 4V5z M23 9l-6 6 M17 9l6 6",
  unmute: "M11 5L6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14",
  markUnread: "M4 4h16v12H5.17L4 17.17V4z",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  video:
    "M23 7l-7 5 7 5V7z M3 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
} as const;

const QUICK_EMOJIS = [
  "\u2764\ufe0f", // ❤️
  "\u{1F44D}", // 👍
  "\u{1F44E}", // 👎
  "\u{1F525}", // 🔥
  "\u{1F970}", // 🥰
  "\u{1F44F}", // 👏
  "\u{1F602}", // 😂
  "\u{1F62E}", // 😮
] as const;

function Bubble({
  msg,
  isGroup,
  replyPreview,
  selectMode,
  selected,
  selectable,
  onToggleSelect,
  onContextMenu,
  onReact,
  onRetry,
  ctxOpen,
}: {
  msg: Message;
  isGroup: boolean;
  replyPreview?: string;
  selectMode: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelect?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  onReact?: (emoji: string) => void;
  onRetry?: () => void;
  ctxOpen: boolean;
}) {
  const canReact = !!onReact && !selectMode && !msg.recalled && !msg.pending && !msg.failed && !ctxOpen;
  // Recommend the message's top reaction if it has one, otherwise the default quick emoji.
  const recommendedEmoji = msg.reactions?.[0]?.emoji ?? QUICK_EMOJIS[0];
  const hasReactions = !msg.recalled && (msg.reactions?.length ?? 0) > 0;

  if (msg.type === "call") {
    return (
      <div className="msg-row system-row">
        <div className="system-msg call-msg">{msg.content || "Call"}</div>
      </div>
    );
  }

  const meta = (
    <span className="meta">
      {msg.recalled && (
        <span className="recall-mark" title="This message was recalled">
          <MenuIcon d={ICONS.trash} style={{ width: 11, height: 11 }} />
        </span>
      )}
      {msg.editedAt && !msg.recalled && <span className="edited-mark">edited </span>}
      {fmtTime(msg.createdAt)}
      {receiptMark(msg)}
      {!selectMode && msg.failed && onRetry && (
        <button type="button" className="btn-ghost" style={{ marginLeft: 6, padding: "0 4px", fontSize: 11 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  );
  return (
    <div
      className={`msg-row ${msg.mine ? "mine" : ""} ${selectMode ? "select-mode" : ""} ${
        selected ? "selected" : ""
      }`}
      onClick={selectMode && selectable ? onToggleSelect : undefined}
    >
      {selectable && selectMode && (
        <button
          type="button"
          className={`select-dot ${selected ? "on" : ""}`}
          title={selected ? "Deselect" : "Select"}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
        >
          {selected ? "\u2713" : ""}
        </button>
      )}
      <div className="bubble-wrap" onContextMenu={onContextMenu}>
        {canReact && (
          <div className="emoji-bar">
            <button
              type="button"
              className="emoji-btn"
              onClick={(e) => {
                e.stopPropagation();
                onReact?.(recommendedEmoji);
              }}
            >
              {recommendedEmoji}
            </button>
          </div>
        )}
        <div className={`bubble ${msg.pending ? "pending" : ""} ${msg.failed ? "error-text" : ""} ${msg.recalled ? "muted" : ""}`}>
          {!msg.mine && isGroup && msg.senderName && (
            <div className="sender">{msg.senderName}</div>
          )}
          {replyPreview && !msg.recalled && (
            <div className="muted" style={{ fontSize: 11, marginBottom: 4, borderLeft: "2px solid #888", paddingLeft: 6 }}>
              {replyPreview}
            </div>
          )}
          {msg.recalled && !msg.content && !msg.mediaUrl ? (
            <span className="recalled-placeholder">Message recalled</span>
          ) : msg.type === "voice" && msg.mediaUrl && !msg.recalled ? (
            <div className="voice-msg">
              <audio controls preload="metadata" src={mediaAuthURL(msg.mediaUrl)} />
              <div className="voice-label">{msg.content || "Voice message"}</div>
            </div>
          ) : msg.type === "image" && msg.mediaUrl && !msg.recalled ? (
            <div className="media-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaAuthURL(msg.mediaUrl)} alt={msg.content || "Photo"} />
            </div>
          ) : msg.type === "file" && msg.mediaUrl && !msg.recalled ? (
            <a
              className="media-file"
              href={mediaAuthURL(msg.mediaUrl)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuIcon d={ICONS.paperclip} style={{ width: 18, height: 18 }} />
              <span>{msg.content || "File"}</span>
            </a>
          ) : (
            <MessageBody text={msg.content} />
          )}
          {hasReactions ? (
            <div className="bubble-footer">
              <div className="reaction-chips">
                {msg.reactions!.map((rx) => (
                  <button
                    key={rx.emoji}
                    type="button"
                    className={`reaction-chip ${rx.mine ? "mine" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReact?.(rx.emoji);
                    }}
                    title={
                      rx.users.length > 0
                        ? rx.users.map((u) => u.name).join(", ")
                        : rx.mine
                          ? "Remove your reaction"
                          : "React too"
                    }
                  >
                    <span className="chip-emoji">{rx.emoji}</span>
                    {rx.users.length > 0 && rx.count <= 3 ? (
                      <span className="chip-avatars">
                        {rx.users.slice(0, 3).map((u) => (
                          <Avatar key={u.id} name={u.name} url={u.avatarUrl} size={20} />
                        ))}
                      </span>
                    ) : (
                      <span className="chip-count">{rx.count}</span>
                    )}
                  </button>
                ))}
              </div>
              {meta}
            </div>
          ) : (
            meta
          )}
        </div>
      </div>
    </div>
  );
}

interface CtxMenuState {
  x: number;
  y: number;
  msgId: string;
}

export default function ChatPageInner() {
  const chat = useChat();
  const call = useCall({ meId: chat.me?.id, subscribe: chat.subscribeEvents });
  const { theme, setTheme } = useTheme();
  const [myStatus, setMyStatus] = useState<"online" | "away" | "dnd" | "offline">("online");
  const { openConversation } = chat;
  const params = useSearchParams();
  const router = useRouter();
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [inChatSearch, setInChatSearch] = useState("");
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [draft, setDraft] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [groupDetails, setGroupDetails] = useState<{
    members: { user_id: string; display_name: string; username: string; role: string; avatar_url?: string; mute_until?: string }[];
    public_id?: string;
    description?: string;
    announcement?: string;
    title?: string;
    role?: string;
    avatar_url?: string;
    mute_all?: boolean;
    forbid_member_friend_add?: boolean;
  } | null>(null);
  const [groupEditTitle, setGroupEditTitle] = useState("");
  const [groupEditDesc, setGroupEditDesc] = useState("");
  const [groupEditAnnounce, setGroupEditAnnounce] = useState("");
  const [groupMetaBusy, setGroupMetaBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const openedFromQuery = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartedRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordMaxRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = chat.conversations.find((c) => c.id === chat.activeId) ?? null;
  const activeMessages = chat.activeId ? chat.messages[chat.activeId] ?? [] : [];
  const isGroup = active?.type === "social_group" || active?.type === "group";

  const selectMode = selectedIds.size > 0;
  const selectedMessages = useMemo(
    () => activeMessages.filter((m) => selectedIds.has(m.id)),
    [activeMessages, selectedIds]
  );
  const recallableSelected = selectedMessages.filter(
    (m) => m.mine && !m.recalled && !m.pending && !m.failed
  );
  const forwardableSelected = selectedMessages.filter((m) => !m.recalled);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function copySelected() {
    const text = selectedMessages
      .filter((m) => !m.recalled)
      .map((m) => m.content)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
    clearSelection();
  }

  async function recallSelected() {
    if (!chat.activeId) return;
    for (const m of recallableSelected) {
      await chat.recallMessage(m.id, chat.activeId);
    }
    clearSelection();
  }

  const canEditGroup =
    isGroup &&
    (groupDetails?.role === "owner" ||
      groupDetails?.role === "admin" ||
      chat.myRole === "owner" ||
      chat.myRole === "admin");

  async function uploadGroupAvatar(file: File) {
    if (!active || !canEditGroup) return;
    setAvatarBusy(true);
    setSendError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "avatar");
      const up = await api<{ url?: string }>("/v1/media/upload", { method: "POST", body: fd });
      const url = String(up?.url ?? "");
      const g = await api<any>(`/v1/groups/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({ avatar_url: url }),
      });
      setGroupDetails((prev) =>
        prev ? { ...prev, avatar_url: String(g?.avatar_url ?? url) } : prev
      );
      await chat.reload();
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function reloadGroupDetails() {
    if (!active || (active.type !== "social_group" && active.type !== "group")) return;
    const g = await api<any>(`/v1/groups/${active.id}`);
    setGroupDetails({
      members: Array.isArray(g?.members) ? g.members : [],
      public_id: g?.public_id,
      description: g?.description,
      announcement: g?.announcement,
      title: g?.title,
      role: g?.role,
      avatar_url: g?.avatar_url,
      mute_all: Boolean(g?.mute_all),
      forbid_member_friend_add: Boolean(g?.forbid_member_friend_add),
    });
    setGroupEditTitle(String(g?.title ?? ""));
    setGroupEditDesc(String(g?.description ?? ""));
    setGroupEditAnnounce(String(g?.announcement ?? ""));
  }

  async function saveGroupMeta() {
    if (!active || !canEditGroup) return;
    setGroupMetaBusy(true);
    try {
      await api(`/v1/groups/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: groupEditTitle.trim(),
          description: groupEditDesc,
          announcement: groupEditAnnounce,
        }),
      });
      await reloadGroupDetails();
      await chat.reload();
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setGroupMetaBusy(false);
    }
  }

  async function toggleForbidFriendAdd() {
    if (!active || !canEditGroup || !groupDetails) return;
    setGroupMetaBusy(true);
    try {
      await api(`/v1/groups/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          forbid_member_friend_add: !groupDetails.forbid_member_friend_add,
        }),
      });
      await reloadGroupDetails();
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setGroupMetaBusy(false);
    }
  }

  /** Timed speak-mute (JD 10m/1h/permanent); Mattermost channel moderation has no timed per-member mute. */
  async function muteMember(userId: string, duration: string) {
    if (!active || !canEditGroup) return;
    await api(`/v1/groups/${active.id}/mute`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, duration }),
    });
    await reloadGroupDetails();
  }

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMsg = ctxMenu ? activeMessages.find((m) => m.id === ctxMenu.msgId) ?? null : null;

  function openCtxMenu(e: ReactMouseEvent, msg: Message) {
    e.preventDefault();
    e.stopPropagation();
    if (msg.pending) return;
    const hasEmojiRow = !selectMode && !msg.recalled && !msg.failed;
    const MENU_W = 200;
    // the emoji row is wider than the menu and centered over it, so it
    // overhangs each side; keep that overhang on-screen too
    const EMOJI_OVERHANG = hasEmojiRow ? 35 : 0;
    const EMOJI_ROW_H = hasEmojiRow ? 46 : 0;
    let itemCount: number;
    if (selectMode && selectedIds.has(msg.id)) {
      itemCount = 3 + (recallableSelected.length > 0 ? 1 : 0);
    } else if (selectMode) {
      itemCount = 1;
    } else {
      itemCount =
        2 + // copy + select always
        (!msg.recalled && !msg.failed ? 2 : 0) + // reply + forward
        (msg.mine && !msg.recalled && !msg.failed ? 1 : 0) + // recall
        (msg.failed ? 1 : 0); // retry
    }
    const MENU_H = itemCount * 38 + 12;
    const x = Math.min(
      Math.max(e.clientX, 8 + EMOJI_OVERHANG),
      window.innerWidth - MENU_W - 8 - EMOJI_OVERHANG
    );
    const y = Math.min(
      Math.max(e.clientY, 8 + EMOJI_ROW_H),
      window.innerHeight - MENU_H - 8
    );
    setCtxMenu({ x, y, msgId: msg.id });
  }

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [ctxMenu]);

  async function copyOne(msg: Message) {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      /* clipboard unavailable */
    }
  }

  useEffect(() => {
    if (!mainMenuOpen && !composeOpen) return;
    const close = () => {
      setMainMenuOpen(false);
      setComposeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [mainMenuOpen, composeOpen]);

  async function logout() {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    }
    clearToken();
    router.replace("/login");
  }

  useEffect(() => {
    api<any>("/v1/me")
      .then((u) => {
        const st = String(u?.status ?? "online");
        if (st === "online" || st === "away" || st === "dnd" || st === "offline") {
          setMyStatus(st);
        }
      })
      .catch(() => {});
  }, []);

  // Mattermost channel info RHS: load group members when details open.
  useEffect(() => {
    if (!showDetails || !active || (active.type !== "social_group" && active.type !== "group")) {
      setGroupDetails(null);
      return;
    }
    let cancelled = false;
    api<any>(`/v1/groups/${active.id}`)
      .then((g) => {
        if (cancelled) return;
        setGroupDetails({
          members: Array.isArray(g?.members) ? g.members : [],
          public_id: g?.public_id,
          description: g?.description,
          announcement: g?.announcement,
          title: g?.title,
          role: g?.role,
          avatar_url: g?.avatar_url,
          mute_all: Boolean(g?.mute_all),
          forbid_member_friend_add: Boolean(g?.forbid_member_friend_add),
        });
        setGroupEditTitle(String(g?.title ?? ""));
        setGroupEditDesc(String(g?.description ?? ""));
        setGroupEditAnnounce(String(g?.announcement ?? ""));
      })
      .catch(() => {
        if (!cancelled) setGroupDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showDetails, active]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chat.conversations;
    return chat.conversations.filter((c) => {
      const name = conversationDisplayName(c).toLowerCase();
      return name.includes(q) || c.title.toLowerCase().includes(q) || (c.friendNote ?? "").toLowerCase().includes(q);
    });
  }, [chat.conversations, query]);

  // Mattermost global search (users + messages) when sidebar query is long enough.
  const globalSearch = useGlobalSearch(query);
  const chatSearch = useGlobalSearch(inChatSearch, chat.activeId);

  useEffect(() => {
    const c = params.get("c");
    if (c && c !== openedFromQuery.current) {
      openedFromQuery.current = c;
      openConversation(c);
    }
  }, [params, openConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeMessages.length, chat.activeId]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [chat.activeId]);

  // Mattermost channel drafts: restore composer text when switching conversations.
  useEffect(() => {
    if (!chat.activeId) {
      setDraft("");
      setEditingMessage(null);
      setReplyTo(null);
      return;
    }
    setEditingMessage(null);
    setReplyTo(null);
    setDraft(getDraft(chat.activeId));
  }, [chat.activeId]);

  useEffect(() => {
    if (!chat.activeId || editingMessage) return;
    const t = setTimeout(() => saveDraft(chat.activeId!, draft), 200);
    return () => clearTimeout(t);
  }, [draft, chat.activeId, editingMessage]);

  // Auto-grow the composer to fit its content (capped by CSS max-height).
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (replyTo || editingMessage) draftRef.current?.focus();
  }, [replyTo, editingMessage]);

  async function send() {
    const text = draft.trim();
    if (!text || !chat.activeId) return;
    setSendError(null);
    // Mattermost edit post: reuse the composer instead of a prompt dialog.
    if (editingMessage) {
      const id = editingMessage.id;
      if (text === editingMessage.content) {
        setEditingMessage(null);
        setDraft(getDraft(chat.activeId));
        return;
      }
      setDraft("");
      setEditingMessage(null);
      try {
        await chat.editMessage(id, chat.activeId, text);
        saveDraft(chat.activeId, "");
      } catch (e: any) {
        setSendError(e.message);
        setEditingMessage({ ...editingMessage, content: text });
        setDraft(text);
      }
      return;
    }
    setDraft("");
    saveDraft(chat.activeId, "");
    const replyId = replyTo?.id;
    setReplyTo(null);
    try {
      await chat.sendMessage(chat.activeId, text, replyId);
    } catch (e: any) {
      setSendError(e.message);
    }
  }

  function startEdit(msg: Message) {
    setReplyTo(null);
    setEditingMessage(msg);
    setDraft(msg.content);
    draftRef.current?.focus();
  }

  function cancelEdit() {
    setEditingMessage(null);
    if (chat.activeId) setDraft(getDraft(chat.activeId));
    else setDraft("");
  }

  function clearRecordTimers() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recordMaxRef.current) {
      clearTimeout(recordMaxRef.current);
      recordMaxRef.current = null;
    }
  }

  function stopMediaTracks() {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }

  function cancelRecording() {
    clearRecordTimers();
    const rec = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    chunksRef.current = [];
    stopMediaTracks();
    setRecording(false);
    setRecordSecs(0);
  }

  async function finishRecording(sendIt: boolean) {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    clearRecordTimers();
    mediaRecorderRef.current = null;
    const durationSec = Math.max(1, Math.round((Date.now() - recordStartedRef.current) / 1000));
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    stopMediaTracks();
    setRecording(false);
    setRecordSecs(0);
    const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (!sendIt || blob.size < 200 || !chat.activeId) return;
    setVoiceBusy(true);
    setSendError(null);
    const replyId = replyTo?.id;
    setReplyTo(null);
    try {
      await chat.sendVoiceMessage(chat.activeId, blob, durationSec, replyId);
    } catch (e: any) {
      setSendError(e.message || "Failed to send voice message");
    } finally {
      setVoiceBusy(false);
    }
  }

  async function startRecording() {
    if (!chat.activeId || recording || voiceBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSendError("Voice messages are not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = rec;
      recordStartedRef.current = Date.now();
      setRecordSecs(0);
      setRecording(true);
      setSendError(null);
      rec.start(250);
      recordTimerRef.current = setInterval(() => {
        setRecordSecs(Math.floor((Date.now() - recordStartedRef.current) / 1000));
      }, 250);
      recordMaxRef.current = setTimeout(() => {
        finishRecording(true).catch(() => {});
      }, VOICE_MAX_SEC * 1000);
    } catch {
      stopMediaTracks();
      setSendError("Microphone permission denied");
    }
  }

  useEffect(() => {
    return () => {
      cancelRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function previewFor(msg: Message): string | undefined {
    if (!msg.replyToId) return undefined;
    const target = activeMessages.find((m) => m.id === msg.replyToId);
    if (!target) return "Reply";
    const body =
      target.type === "voice" ? target.content || "Voice message" : target.content;
    return `${target.senderName ?? (target.mine ? "You" : "User")}: ${body}`;
  }

  return (
    <AppShell rail={false}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <button
            type="button"
            className={`icon-btn ${mainMenuOpen ? "active" : ""}`}
            title="Menu"
            onClick={(e) => {
              e.stopPropagation();
              setComposeOpen(false);
              setMainMenuOpen((v) => !v);
            }}
          >
            <MenuIcon d={ICONS.menu} />
          </button>
          <div className="search-wrap">
            <input
              className="search-input"
              placeholder={chat.connected ? "Search" : "Reconnecting\u2026"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!chat.connected && <span className="spinner" aria-label="Reconnecting" />}
          </div>
          {mainMenuOpen && (
            <div className="popup-menu main-menu" onClick={(e) => e.stopPropagation()}>
              <Link className="ctx-item" href="/profile">
                <Avatar
                  name={chat.me?.nickname || chat.me?.username || "?"}
                  url={chat.me?.avatarUrl}
                  size={22}
                />
                {chat.me?.nickname || chat.me?.username || "My profile"}
              </Link>
              <div className="ctx-sep" />
              <Link className="ctx-item" href="/friends">
                <MenuIcon d={ICONS.user} />
                Contacts
              </Link>
              <Link className="ctx-item" href="/groups">
                <MenuIcon d={ICONS.users} />
                Groups
              </Link>
              <Link className="ctx-item" href="/profile">
                <MenuIcon d={ICONS.settings} />
                Settings
              </Link>
              <button
                className="ctx-item"
                onClick={() => {
                  const order = ["dark", "light", "system"] as const;
                  const i = order.indexOf(theme);
                  setTheme(order[(i + 1) % order.length]);
                }}
              >
                <MenuIcon d={ICONS.settings} />
                Theme: {theme}
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  const order = ["online", "away", "dnd", "offline"] as const;
                  const i = order.indexOf(myStatus);
                  const next = order[(i + 1) % order.length];
                  setMyStatus(next);
                  api("/v1/me/status", {
                    method: "PUT",
                    body: JSON.stringify({ status: next }),
                  }).catch(() => {});
                }}
              >
                <MenuIcon d={ICONS.user} />
                Status: {myStatus}
              </button>
              <div className="ctx-sep" />
              <button className="ctx-item" onClick={logout}>
                <MenuIcon d={ICONS.logout} />
                Log Out
              </button>
            </div>
          )}
        </div>
        <div className="conv-list">
          {globalSearch.active ? (
            <div className="search-results">
              {globalSearch.loading && <div className="muted" style={{ padding: 12 }}>Searching…</div>}
              {globalSearch.users.length > 0 && (
                <div className="search-section">
                  <div className="search-section-title">People</div>
                  {globalSearch.users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="search-hit"
                      onClick={() => {
                        chat.openDM(u.id).catch(() => {});
                        setQuery("");
                      }}
                    >
                      <Avatar name={u.displayName} size={36} />
                      <div>
                        <div className="conv-title">{u.displayName}</div>
                        <div className="muted" style={{ fontSize: 12 }}>@{u.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {globalSearch.messages.length > 0 && (
                <div className="search-section">
                  <div className="search-section-title">Messages</div>
                  {globalSearch.messages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="search-hit"
                      onClick={() => {
                        chat.openConversation(m.conversationId);
                        setQuery("");
                      }}
                    >
                      <div className="search-hit-body">{m.body}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{fmtTime(m.createdAt)}</div>
                    </button>
                  ))}
                </div>
              )}
              {!globalSearch.loading &&
                globalSearch.users.length === 0 &&
                globalSearch.messages.length === 0 && (
                  <div className="muted" style={{ padding: 14 }}>No results</div>
                )}
            </div>
          ) : (
            <>
          {chat.loadError && (
            <div style={{ padding: 14 }}>
              <div className="error-text">{chat.loadError}</div>
              <button className="btn-ghost" onClick={chat.reload} style={{ marginTop: 6 }}>
                Retry
              </button>
            </div>
          )}
          {!chat.loadError && filtered.length === 0 && (
            <div style={{ padding: 20 }} className="muted">
              No conversations yet. Add a friend or create a group.
            </div>
          )}
          {filtered.map((c) => (
            <ConversationRow
              key={c.id}
              conv={c}
              active={c.id === chat.activeId}
              typing={chat.typingByConv[c.id] ?? []}
              online={
                c.peerId
                  ? chat.presenceByUser[c.peerId]?.online ?? c.peerOnline
                  : undefined
              }
              onClick={() => chat.openConversation(c.id)}
              onFavorite={() =>
                chat.updateConversationPrefs(c.id, { favorite: !c.favorite }).catch(() => {})
              }
              onMute={() =>
                chat.updateConversationPrefs(c.id, { muted: !c.muted }).catch(() => {})
              }
              onMarkUnread={() => chat.markConversationUnread(c.id).catch(() => {})}
            />
          ))}
            </>
          )}
        </div>
        <button
          type="button"
          className={`fab ${composeOpen ? "open" : ""}`}
          title={composeOpen ? "Close" : "New message"}
          onClick={(e) => {
            e.stopPropagation();
            setMainMenuOpen(false);
            setComposeOpen((v) => !v);
          }}
        >
          {composeOpen ? "\u2715" : <MenuIcon d={ICONS.pencil} style={{ width: 20, height: 20 }} />}
        </button>
        {composeOpen && (
          <div className="popup-menu compose-menu" onClick={(e) => e.stopPropagation()}>
            <Link className="ctx-item" href="/groups">
              <MenuIcon d={ICONS.users} />
              New Group
            </Link>
            <Link className="ctx-item" href="/friends">
              <MenuIcon d={ICONS.user} />
              New Private Chat
            </Link>
          </div>
        )}
      </aside>

      <main className="chat-pane">
        {!active ? (
          <div className="empty-state">
            <div style={{ fontSize: 44 }}>{"\u{1F4AC}"}</div>
            <div>Select a chat to start messaging</div>
          </div>
        ) : (
          <>
            {selectMode ? (
              <div className="chat-header select-bar">
                <button
                  className="btn-ghost"
                  style={{ borderRadius: 8, padding: "6px 10px" }}
                  onClick={clearSelection}
                  title="Cancel selection"
                >
                  {"\u2715"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{selectedIds.size} selected</div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ borderRadius: 8, padding: "6px 10px" }}
                  onClick={copySelected}
                >
                  Copy
                </button>
                {forwardableSelected.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ borderRadius: 8, padding: "6px 10px" }}
                    onClick={() => setForwardIds(forwardableSelected.map((m) => m.id))}
                  >
                    Forward
                  </button>
                )}
                {recallableSelected.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ borderRadius: 8, padding: "6px 10px", color: "var(--danger)" }}
                    onClick={recallSelected}
                  >
                    Recall
                  </button>
                )}
              </div>
            ) : showInChatSearch ? (
              <div className="chat-header" onClick={(e) => e.stopPropagation()}>
                <input
                  className="search-input"
                  autoFocus
                  placeholder="Search in conversation"
                  value={inChatSearch}
                  onChange={(e) => setInChatSearch(e.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title="Close search"
                  onClick={() => {
                    setShowInChatSearch(false);
                    setInChatSearch("");
                  }}
                >
                  {"\u2715"}
                </button>
              </div>
            ) : (
              <div className="chat-header">
                <div
                  className="chat-header clickable"
                  style={{ flex: 1, border: "none", padding: 0, minWidth: 0 }}
                  title="View details"
                  onClick={() => setShowDetails(true)}
                >
                  <Avatar
                    name={conversationDisplayName(active)}
                    url={active.avatarUrl}
                    size={38}
                    showStatus={active.type === "dm"}
                    online={
                      active.peerId
                        ? chat.presenceByUser[active.peerId]?.online ?? active.peerOnline
                        : undefined
                    }
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title">{conversationDisplayName(active)}</div>
                    <div className="sub">
                      {formatTypingLabel(chat.typingByConv[active.id] ?? []) ||
                        (active.type === "dm"
                          ? (() => {
                              const p = active.peerId
                                ? chat.presenceByUser[active.peerId]
                                : undefined;
                              const online = p?.online ?? active.peerOnline;
                              if (online) return "online";
                              return formatLastSeen(p?.lastActiveAt || active.peerLastActiveAt);
                            })()
                          : `${active.type.replace("_", " ")}${isGroup ? ` · ${chat.myRole}` : ""}`)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title="Search in chat"
                  onClick={() => setShowInChatSearch(true)}
                >
                  <MenuIcon d={"M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M21 21l-4.3-4.3"} />
                </button>
                {active.type === "dm" && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Voice call"
                      disabled={!!call.active || !!call.incoming}
                      onClick={() => {
                        call.startCall(active.id, "voice").catch((e) => setSendError(e.message));
                      }}
                    >
                      <MenuIcon d={ICONS.phone} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Video call"
                      disabled={!!call.active || !!call.incoming}
                      onClick={() => {
                        call.startCall(active.id, "video").catch((e) => setSendError(e.message));
                      }}
                    >
                      <MenuIcon d={ICONS.video} />
                    </button>
                  </>
                )}
              </div>
            )}

            {showInChatSearch && chatSearch.active && (
              <div className="inchat-search-results">
                {chatSearch.loading && <div className="muted">Searching…</div>}
                {chatSearch.messages.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="search-hit"
                    onClick={() => {
                      const el = document.getElementById(`msg-${m.id}`);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      el?.classList.add("msg-flash");
                      setTimeout(() => el?.classList.remove("msg-flash"), 1200);
                    }}
                  >
                    <div className="search-hit-body">{m.body}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{fmtTime(m.createdAt)}</div>
                  </button>
                ))}
                {!chatSearch.loading && chatSearch.messages.length === 0 && (
                  <div className="muted">No matches in this chat</div>
                )}
              </div>
            )}

            {active.pinnedMessageId && active.pinnedMessage && (
              <div className="pinned-banner">
                <MenuIcon d={ICONS.pin} style={{ width: 16, height: 16 }} />
                <div className="pinned-text">{active.pinnedMessage}</div>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ flex: "none", padding: "2px 6px" }}
                  onClick={() =>
                    chat.pinMessage(active.pinnedMessageId!, active.id, false).catch(() => {})
                  }
                >
                  Unpin
                </button>
              </div>
            )}

            <div className="msg-scroll" ref={scrollRef}>
              {activeMessages.length === 0 && (
                <div className="empty-state" style={{ minHeight: 200 }}>
                  <div className="muted">No messages here yet…</div>
                </div>
              )}
              {activeMessages.map((m) => (
                <div key={m.id} id={`msg-${m.id}`}>
                <Bubble
                  msg={m}
                  isGroup={!!isGroup}
                  replyPreview={previewFor(m)}
                  selectMode={selectMode}
                  selected={selectedIds.has(m.id)}
                  selectable={!m.pending && !m.failed}
                  onToggleSelect={() => toggleSelect(m.id)}
                  onContextMenu={(e) => openCtxMenu(e, m)}
                  ctxOpen={!!ctxMenu}
                  onReact={
                    chat.activeId
                      ? (emoji) => chat.reactMessage(m.id, chat.activeId!, emoji).catch(() => {})
                      : undefined
                  }
                  onRetry={
                    m.failed && chat.activeId
                      ? () => chat.retryMessage(chat.activeId!, m)
                      : undefined
                  }
                />
                </div>
              ))}
            </div>

            {sendError && (
              <div
                className="error-text"
                style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "0 16px" }}
              >
                Failed to send: {sendError}
              </div>
            )}

            <div className="composer">
              <div className="composer-box">
                {editingMessage ? (
                  <div className="reply-banner edit-banner">
                    <MenuIcon d={ICONS.edit} style={{ width: 22, height: 22 }} />
                    <div className="reply-body">
                      <div className="reply-name">Edit message</div>
                      <div className="reply-text">{editingMessage.content}</div>
                    </div>
                    <button
                      type="button"
                      className="reply-close"
                      title="Cancel edit"
                      onClick={cancelEdit}
                    >
                      {"\u2715"}
                    </button>
                  </div>
                ) : replyTo ? (
                  <div className="reply-banner">
                    <MenuIcon d={ICONS.reply} style={{ width: 22, height: 22 }} />
                    <div className="reply-body">
                      <div className="reply-name">
                        Reply to {replyTo.mine
                          ? chat.me?.nickname || chat.me?.username || "You"
                          : replyTo.senderName || active.title}
                      </div>
                      <div className="reply-text">{replyTo.content}</div>
                    </div>
                    <button
                      type="button"
                      className="reply-close"
                      title="Cancel reply"
                      onClick={() => setReplyTo(null)}
                    >
                      {"\u2715"}
                    </button>
                  </div>
                ) : null}
                <div className="composer-row">
                  {recording ? (
                    <>
                      <button
                        type="button"
                        className="send-btn danger"
                        title="Cancel recording"
                        onClick={cancelRecording}
                      >
                        {"\u2715"}
                      </button>
                      <div className="recording-pill">
                        <span className="recording-dot" />
                        Recording {Math.floor(recordSecs / 60)}:
                        {(recordSecs % 60).toString().padStart(2, "0")}
                        <span className="muted"> / 1:00</span>
                      </div>
                      <button
                        type="button"
                        className="send-btn"
                        title="Send voice message"
                        disabled={voiceBusy}
                        onClick={() => finishRecording(true)}
                      >
                        {"\u27A4"}
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf,audio/*,video/mp4,application/pdf"
                        style={{ display: "none" }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file || !chat.activeId) return;
                          setSendError(null);
                          const replyId = replyTo?.id;
                          setReplyTo(null);
                          try {
                            await chat.sendMediaMessage(chat.activeId, file, replyId);
                          } catch (err: any) {
                            setSendError(err.message || "Upload failed");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="attach-btn"
                        title="Attach file"
                        disabled={voiceBusy || !chat.activeId}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <MenuIcon d={ICONS.paperclip} style={{ width: 20, height: 20 }} />
                      </button>
                      <textarea
                        ref={draftRef}
                        rows={1}
                        placeholder="Message"
                        value={draft}
                        disabled={voiceBusy}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDraft(value);
                          if (!chat.activeId) return;
                          if (value.trim()) chat.notifyTyping(chat.activeId);
                          else chat.stopTyping(chat.activeId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                      />
                      {draft.trim() ? (
                        <button
                          className="send-btn"
                          onClick={send}
                          title={editingMessage ? "Save edit" : "Send"}
                          disabled={voiceBusy}
                        >
                          {"\u27A4"}
                        </button>
                      ) : editingMessage ? (
                        <button className="send-btn danger" onClick={cancelEdit} title="Cancel edit">
                          {"\u2715"}
                        </button>
                      ) : (
                        <button
                          className="send-btn"
                          title="Record voice message"
                          disabled={voiceBusy || !chat.activeId}
                          onClick={startRecording}
                        >
                          <MenuIcon d={ICONS.mic} style={{ width: 20, height: 20 }} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {active && showDetails && (
        <aside className="details-panel">
          <button
            type="button"
            className="details-close"
            title="Close"
            onClick={() => setShowDetails(false)}
          >
            {"\u2715"}
          </button>
          <Avatar
            name={conversationDisplayName(active)}
            url={groupDetails?.avatar_url || active.avatarUrl}
            size={96}
          />
          {canEditGroup && (
            <>
              <input
                ref={groupAvatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadGroupAvatar(f).catch(() => {});
                }}
              />
              <button
                type="button"
                className="btn-ghost"
                style={{ marginTop: 8 }}
                disabled={avatarBusy}
                onClick={() => groupAvatarInputRef.current?.click()}
              >
                {avatarBusy ? "Uploading…" : "Change group avatar"}
              </button>
            </>
          )}
          <div style={{ fontSize: 17, fontWeight: 700 }}>{conversationDisplayName(active)}</div>
          {active.type === "dm" && active.friendNote && (
            <div className="muted" style={{ fontSize: 13 }}>
              {active.title}
            </div>
          )}
          {active.type === "dm" && active.friendTags && active.friendTags.length > 0 && (
            <div className="tag-chip-row" style={{ marginTop: 8 }}>
              {active.friendTags.map((t) => (
                <span key={t} className="tag-chip">
                  #{t}
                </span>
              ))}
            </div>
          )}
          {active.type === "dm" && active.friendshipId && (
            <FriendNoteEditor
              friendshipId={active.friendshipId}
              note={active.friendNote ?? ""}
              tags={active.friendTags ?? []}
              onSaved={() => chat.reload()}
            />
          )}
          <div className="kv">
            <div className="k">Type</div>
            <div>{active.type}</div>
          </div>
          <div className="kv">
            <div className="k">Conversation ID</div>
            <div style={{ wordBreak: "break-all" }}>{active.id}</div>
          </div>
          <div className="kv">
            <div className="k">Last activity</div>
            <div>{active.lastMessageAt ? fmtTime(active.lastMessageAt) : "\u2014"}</div>
          </div>
          {isGroup && groupDetails && (
            <>
              {groupDetails.public_id && (
                <div className="kv">
                  <div className="k">Invite ID</div>
                  <div>{groupDetails.public_id}</div>
                </div>
              )}
              {groupDetails.public_id && (
                <div className="group-qr-block">
                  <div className="k" style={{ marginBottom: 8 }}>
                    Invite QR
                  </div>
                  <GroupQr publicId={groupDetails.public_id} size={140} />
                </div>
              )}
              {canEditGroup ? (
                <div className="group-meta-edit">
                  <label className="k">Group name</label>
                  <input
                    value={groupEditTitle}
                    onChange={(e) => setGroupEditTitle(e.target.value)}
                    maxLength={80}
                  />
                  <label className="k">Description</label>
                  <textarea
                    value={groupEditDesc}
                    onChange={(e) => setGroupEditDesc(e.target.value)}
                    rows={2}
                    maxLength={500}
                  />
                  <label className="k">Announcement</label>
                  <textarea
                    value={groupEditAnnounce}
                    onChange={(e) => setGroupEditAnnounce(e.target.value)}
                    rows={2}
                    maxLength={1000}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={groupMetaBusy}
                    onClick={() => saveGroupMeta().catch(() => {})}
                  >
                    {groupMetaBusy ? "Saving…" : "Save group info"}
                  </button>
                  <label className="group-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(groupDetails.forbid_member_friend_add)}
                      disabled={groupMetaBusy}
                      onChange={() => toggleForbidFriendAdd().catch(() => {})}
                    />
                    Forbid members adding each other as friends
                  </label>
                </div>
              ) : (
                <>
                  {groupDetails.announcement && (
                    <div className="kv">
                      <div className="k">Announcement</div>
                      <div>{groupDetails.announcement}</div>
                    </div>
                  )}
                  {groupDetails.description && (
                    <div className="kv">
                      <div className="k">Description</div>
                      <div>{groupDetails.description}</div>
                    </div>
                  )}
                  {groupDetails.forbid_member_friend_add && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Members cannot add each other as friends.
                    </div>
                  )}
                </>
              )}
              <div className="kv">
                <div className="k">Your role</div>
                <div>{groupDetails.role || chat.myRole}</div>
              </div>
              {groupDetails.mute_all && (
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                  Whole group is muted (members cannot send).
                </div>
              )}
              <div className="details-members">
                <div className="k" style={{ marginBottom: 8 }}>
                  Members ({groupDetails.members.length})
                </div>
                {groupDetails.members.map((m) => {
                  const mutedUntil = m.mute_until ? new Date(m.mute_until) : null;
                  const isMuted =
                    mutedUntil != null && !Number.isNaN(mutedUntil.getTime()) && mutedUntil.getTime() > Date.now();
                  const permanentMute =
                    mutedUntil != null && mutedUntil.getUTCFullYear() >= 9999;
                  return (
                    <div key={m.user_id} className="details-member details-member-admin">
                      <Avatar name={m.display_name} url={m.avatar_url} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{m.display_name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          @{m.username} · {m.role}
                          {isMuted
                            ? permanentMute
                              ? " · muted permanently"
                              : ` · muted until ${mutedUntil!.toLocaleString()}`
                            : ""}
                        </div>
                        {canEditGroup && m.role !== "owner" && (
                          <div className="mute-actions">
                            <button
                              type="button"
                              className="btn-ghost mute-chip"
                              onClick={() => muteMember(m.user_id, "10m").catch(() => {})}
                            >
                              10m
                            </button>
                            <button
                              type="button"
                              className="btn-ghost mute-chip"
                              onClick={() => muteMember(m.user_id, "1h").catch(() => {})}
                            >
                              1h
                            </button>
                            <button
                              type="button"
                              className="btn-ghost mute-chip"
                              onClick={() => muteMember(m.user_id, "permanent").catch(() => {})}
                            >
                              Mute
                            </button>
                            {isMuted && (
                              <button
                                type="button"
                                className="btn-ghost mute-chip"
                                onClick={() => muteMember(m.user_id, "off").catch(() => {})}
                              >
                                Unmute
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {canEditGroup && (
                <div className="mute-group-actions">
                  {groupDetails.mute_all ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => muteMember("", "all_off").catch(() => {})}
                    >
                      Unmute whole group
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => muteMember("", "all").catch(() => {})}
                    >
                      Mute whole group
                    </button>
                  )}
                </div>
              )}
              <Link className="btn-ghost" href="/groups" style={{ marginTop: 12, textAlign: "center" }}>
                More group settings
              </Link>
            </>
          )}
          {active.muted != null && (
            <button
              className="btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() =>
                chat.updateConversationPrefs(active.id, { muted: !active.muted }).catch(() => {})
              }
            >
              {active.muted ? "Unmute conversation" : "Mute conversation"}
            </button>
          )}
        </aside>
      )}

      {ctxMenu && ctxMsg && selectMode && selectedIds.has(ctxMsg.id) && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              copySelected();
              setCtxMenu(null);
            }}
          >
            <MenuIcon d={ICONS.copy} />
            Copy selected
          </button>
          {forwardableSelected.length > 0 && (
            <button
              className="ctx-item"
              onClick={() => {
                setForwardIds(forwardableSelected.map((m) => m.id));
                setCtxMenu(null);
              }}
            >
              <MenuIcon d={ICONS.forward} />
              Forward selected
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              clearSelection();
              setCtxMenu(null);
            }}
          >
            <MenuIcon d={ICONS.select} />
            Clear selection
          </button>
          {recallableSelected.length > 0 && (
            <>
              <div className="ctx-sep" />
              <button
                className="ctx-item danger"
                onClick={() => {
                  recallSelected();
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.trash} />
                Recall selected
              </button>
            </>
          )}
        </div>
      )}

      {ctxMenu && ctxMsg && selectMode && !selectedIds.has(ctxMsg.id) && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              toggleSelect(ctxMsg.id);
              setCtxMenu(null);
            }}
          >
            <MenuIcon d={ICONS.select} />
            Select
          </button>
        </div>
      )}

      {ctxMenu && ctxMsg && !selectMode && (
        <div
          className="ctx-wrap"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {!ctxMsg.recalled && !ctxMsg.failed && chat.activeId && (
            <div className="ctx-emoji-row">
              {QUICK_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className="emoji-btn"
                  onClick={() => {
                    chat.reactMessage(ctxMsg.id, chat.activeId!, em).catch(() => {});
                    setCtxMenu(null);
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
          <div className="ctx-menu">
          {!ctxMsg.recalled && !ctxMsg.failed && (
            <button
              className="ctx-item"
              onClick={() => {
                setEditingMessage(null);
                setReplyTo(ctxMsg);
                setCtxMenu(null);
              }}
            >
              <MenuIcon d={ICONS.reply} />
              Reply
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              copyOne(ctxMsg);
              setCtxMenu(null);
            }}
          >
            <MenuIcon d={ICONS.copy} />
            Copy
          </button>
          {!ctxMsg.recalled && !ctxMsg.failed && (
            <button
              className="ctx-item"
              onClick={() => {
                setForwardIds([ctxMsg.id]);
                setCtxMenu(null);
              }}
            >
              <MenuIcon d={ICONS.forward} />
              Forward
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              toggleSelect(ctxMsg.id);
              setCtxMenu(null);
            }}
          >
            <MenuIcon d={ICONS.select} />
            Select
          </button>
          {ctxMsg.failed && chat.activeId && (
            <button
              className="ctx-item"
              onClick={() => {
                chat.retryMessage(chat.activeId!, ctxMsg);
                setCtxMenu(null);
              }}
            >
              <MenuIcon d={ICONS.retry} />
              Retry
            </button>
          )}
          {ctxMsg.mine && !ctxMsg.recalled && !ctxMsg.failed && chat.activeId && (
            <>
              <div className="ctx-sep" />
              {ctxMsg.type !== "voice" && ctxMsg.type !== "image" && ctxMsg.type !== "file" && (
                <button
                  className="ctx-item"
                  onClick={() => {
                    startEdit(ctxMsg);
                    setCtxMenu(null);
                  }}
                >
                  <MenuIcon d={ICONS.edit} />
                  Edit
                </button>
              )}
              <button
                className="ctx-item"
                onClick={() => {
                  const pinned = active?.pinnedMessageId === ctxMsg.id;
                  chat.pinMessage(ctxMsg.id, chat.activeId!, !pinned).catch(() => {});
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.pin} />
                {active?.pinnedMessageId === ctxMsg.id ? "Unpin" : "Pin"}
              </button>
              <button
                className="ctx-item danger"
                onClick={() => {
                  chat.recallMessage(ctxMsg.id, chat.activeId!);
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.trash} />
                Recall
              </button>
            </>
          )}
          {!ctxMsg.mine && !ctxMsg.recalled && chat.activeId && (
            <button
              className="ctx-item"
              onClick={() => {
                const pinned = active?.pinnedMessageId === ctxMsg.id;
                chat.pinMessage(ctxMsg.id, chat.activeId!, !pinned).catch(() => {});
                setCtxMenu(null);
              }}
            >
              <MenuIcon d={ICONS.pin} />
              {active?.pinnedMessageId === ctxMsg.id ? "Unpin" : "Pin"}
            </button>
          )}
          </div>
        </div>
      )}

      {forwardIds && forwardIds.length > 0 && (
        <ForwardPicker
          conversations={chat.conversations.filter((c) => c.id !== chat.activeId)}
          messageCount={forwardIds.length}
          onCancel={() => setForwardIds(null)}
          onSend={async (targetIds) => {
            for (const id of forwardIds) {
              await chat.forwardMessage(id, targetIds);
            }
            setForwardIds(null);
            clearSelection();
          }}
        />
      )}
      <CallOverlay call={call} />
    </AppShell>
  );
}

/** Mattermost ForwardPostModal-style picker; Qchat API already accepts multiple conversation_ids. */
function ForwardPicker({
  conversations,
  messageCount,
  onCancel,
  onSend,
}: {
  conversations: Conversation[];
  messageCount: number;
  onCancel: () => void;
  onSend: (conversationIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      await onSend(Array.from(selected));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="forward-modal" role="dialog" aria-label="Forward messages">
      <div className="forward-modal-card">
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
          Forward {messageCount > 1 ? `${messageCount} messages` : "message"} to…
        </h3>
        <input
          placeholder="Search conversations"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div className="forward-modal-list">
          {filtered.length === 0 && <div className="muted">No conversations</div>}
          {filtered.map((c) => (
            <label key={c.id} className="forward-modal-row">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <Avatar name={conversationDisplayName(c)} url={c.avatarUrl} size={32} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{conversationDisplayName(c)}</span>
                <span className="muted" style={{ display: "block", fontSize: 12 }}>
                  {c.type === "dm" ? "Direct message" : "Group"}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="forward-modal-actions">
          <button className="btn-ghost" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => submit().catch(() => {})}
          >
            {busy
              ? "Sending…"
              : selected.size > 0
                ? `Send to ${selected.size}`
                : "Select targets"}
          </button>
        </div>
      </div>
    </div>
  );
}
