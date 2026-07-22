"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import CallOverlay from "@/components/CallOverlay";
import FriendNoteEditor from "@/components/FriendNoteEditor";
import GroupQr from "@/components/GroupQr";
import MessageBody from "@/components/MessageBody";
import { api, clearToken, mediaAuthURL, setTokens, getRefreshToken } from "@/lib/api";
import { getAuthDevice } from "@/lib/device";
import { formatTypingLabel, useChat, type TypingUser } from "@/lib/useChat";
import { useCall } from "@/lib/useCall";
import { Conversation, Message, conversationDisplayName, formatLastSeen } from "@/lib/types";
import { useTheme } from "@/lib/theme";
import { useGlobalSearch } from "@/lib/useSearch";
import { getDraft, saveDraft } from "@/lib/drafts";
import { dataTransferHasFiles, filesFromDataTransfer, imagesFromClipboard, imagesFromClipboardApi } from "@/lib/fileDrop";
import { makeImagePreviewUrl } from "@/lib/mediaPreview";
import {
  nextPinnedFromScroll,
  previousPinnedInCycle,
  type PinnedMessage,
} from "@/lib/pinnedCycle";
import { attachmentLimitError, avatarLimitError, VOICE_MAX_SEC } from "@/lib/mediaLimits";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { unregisterWebPush } from "@/lib/webPush";

/** Chat errors go to the console only — never surface as UI banners. */
function logChatError(...args: unknown[]) {
  console.error("[qchat]", ...args);
}

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
  dropHover,
  onClick,
  onFavorite,
  onMute,
  onDropHover,
  onFilesDrop,
}: {
  conv: Conversation;
  active: boolean;
  typing: TypingUser[];
  online?: boolean;
  dropHover?: boolean;
  onClick: () => void;
  onFavorite: () => void;
  onMute: () => void;
  onDropHover?: (hover: boolean) => void;
  onFilesDrop?: (files: File[]) => void;
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
      className={`conv-item ${active ? "active" : ""} ${conv.muted ? "muted-conv" : ""} ${conv.favorite ? "favorited" : ""
        } ${dropHover ? "drop-hover" : ""}`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragEnter={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        onDropHover?.(true);
      }}
      onDragOver={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        onDropHover?.(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        onDropHover?.(false);
      }}
      onDrop={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        onDropHover?.(false);
        const files = filesFromDataTransfer(e.dataTransfer);
        if (files.length) onFilesDrop?.(files);
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
  close: "M18 6L6 18 M6 6l12 12",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  back: "M15 18l-6-6 6-6",
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
  /** Pin + list affordance for opening the pinned messages panel. */
  pinList:
    "M12 2v8l3 3H9l3-3V2z M8 14h8 M8 17h6 M8 20h4 M5 12.5V22h14V12.5",
  mute: "M11 5L6 9H2v6h4l5 4V5z M23 9l-6 6 M17 9l6 6",
  unmute: "M11 5L6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  video:
    "M23 7l-7 5 7 5V7z M3 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  building:
    "M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6 M9 10h.01 M15 10h.01 M9 14h.01 M15 14h.01",
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
  pinned,
  onToggleSelect,
  onContextMenu,
  onReact,
  onRetry,
  onCancelUpload,
  ctxOpen,
}: {
  msg: Message;
  isGroup: boolean;
  replyPreview?: string;
  selectMode: boolean;
  selected: boolean;
  selectable: boolean;
  pinned?: boolean;
  onToggleSelect?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  onReact?: (emoji: string) => void;
  onRetry?: () => void;
  onCancelUpload?: () => void;
  ctxOpen: boolean;
}) {
  const canReact = !!onReact && !selectMode && !msg.recalled && !msg.pending && !msg.failed && !ctxOpen;
  // Recommend the message's top reaction if it has one, otherwise the default quick emoji.
  const recommendedEmoji = msg.reactions?.[0]?.emoji ?? QUICK_EMOJIS[0];
  const hasReactions = !msg.recalled && (msg.reactions?.length ?? 0) > 0;
  const canCancelUpload =
    !selectMode &&
    msg.pending &&
    typeof msg.uploadProgress === "number" &&
    !!onCancelUpload;

  if (msg.type === "call") {
    return (
      <div className="msg-row system-row">
        <div className="system-msg call-msg">{msg.content || "Call"}</div>
      </div>
    );
  }

  const meta = (
    <span className="meta">
      {pinned && !msg.recalled && (
        <span className="pin-mark" title="Pinned message">
          <MenuIcon d={ICONS.pin} style={{ width: 11, height: 11 }} />
        </span>
      )}
      {msg.recalled && (
        <span className="recall-mark" title="This message was recalled">
          <MenuIcon d={ICONS.trash} style={{ width: 11, height: 11 }} />
        </span>
      )}
      {msg.editedAt && !msg.recalled && <span className="edited-mark">edited </span>}
      {fmtTime(msg.createdAt)}
      {receiptMark(msg)}
      {canCancelUpload && (
        <button
          type="button"
          className="msg-action-icon"
          title="Cancel upload"
          aria-label="Cancel upload"
          onClick={(e) => {
            e.stopPropagation();
            onCancelUpload();
          }}
        >
          <MenuIcon d={ICONS.close} style={{ width: 13, height: 13 }} />
        </button>
      )}
      {!selectMode && msg.failed && onRetry && (
        <button
          type="button"
          className="msg-action-icon"
          title="Retry"
          aria-label="Retry"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          <MenuIcon d={ICONS.retry} style={{ width: 13, height: 13 }} />
        </button>
      )}
    </span>
  );
  return (
    <div
      className={`msg-row ${msg.mine ? "mine" : ""} ${selectMode ? "select-mode" : ""} ${selected ? "selected" : ""
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
        <div className={`bubble ${msg.pending ? "pending" : ""} ${msg.failed ? "failed" : ""} ${msg.recalled ? "muted" : ""}`}>
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
              {msg.content && msg.content !== "Photo" && (
                <div className="media-caption">
                  <MessageBody text={msg.content} />
                </div>
              )}
              {msg.pending && typeof msg.uploadProgress === "number" && (
                <div className="upload-progress" aria-hidden>
                  <div
                    className="upload-progress-bar"
                    style={{ width: `${Math.round(msg.uploadProgress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ) : msg.type === "file" && (msg.mediaUrl || msg.pending || msg.failed) && !msg.recalled ? (
            <div className="media-file-wrap">
              {msg.mediaUrl && !msg.failed ? (
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
                <div className="media-file">
                  <MenuIcon d={ICONS.paperclip} style={{ width: 18, height: 18 }} />
                  <span>{msg.content || "File"}</span>
                </div>
              )}
              {msg.pending && typeof msg.uploadProgress === "number" && (
                <div className="upload-progress inline" aria-hidden>
                  <div
                    className="upload-progress-bar"
                    style={{ width: `${Math.round(msg.uploadProgress * 100)}%` }}
                  />
                </div>
              )}
            </div>
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
  const router = useRouter();
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [joinCompanyOpen, setJoinCompanyOpen] = useState(false);
  const [joinInvite, setJoinInvite] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  /** Narrow layout: list ↔ chat (Mattermost mobile channel view). */
  const narrowLayout = useMediaQuery("(max-width: 768px)");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const wasNarrowRef = useRef(false);
  const [query, setQuery] = useState("");
  const [inChatSearch, setInChatSearch] = useState("");
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [draft, setDraft] = useState("");
  /** Pending media from paste / attach / drop before send. */
  const [mediaDraft, setMediaDraft] = useState<{
    items: { file: File; url: string }[];
    mode: "photos" | "files";
    caption: string;
    replyToId?: string;
  } | null>(null);
  const [mediaSending, setMediaSending] = useState(false);
  const mediaCaptionRef = useRef<HTMLTextAreaElement>(null);
  const mediaDraftRef = useRef<typeof mediaDraft>(null);
  mediaDraftRef.current = mediaDraft;
  const clipboardIngestLock = useRef(false);
  const [showDetails, setShowDetails] = useState(false);
  /** Conversation id under file drag in the sidebar list (Mattermost channel drop). */
  const [dropHoverConvId, setDropHoverConvId] = useState<string | null>(null);
  /** File drag over the open chat history pane. */
  const [chatDropActive, setChatDropActive] = useState(false);
  const chatDropDepthRef = useRef(0);
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
  /** Members available for @ autocomplete (Mattermost suggestion box). */
  const [mentionMembers, setMentionMembers] = useState<
    { userId: string; username: string; displayName: string; avatarUrl?: string }[]
  >([]);
  const [mentionMenu, setMentionMenu] = useState<{
    query: string;
    start: number;
    index: number;
  } | null>(null);
  const [groupEditTitle, setGroupEditTitle] = useState("");
  const [groupEditDesc, setGroupEditDesc] = useState("");
  const [groupEditAnnounce, setGroupEditAnnounce] = useState("");
  const [groupMetaBusy, setGroupMetaBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [barPin, setBarPin] = useState<PinnedMessage | null>(null);
  const [pinsListOpen, setPinsListOpen] = useState(false);
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
  const pinnedList: PinnedMessage[] = useMemo(() => {
    if (!active) return [];
    if (active.pinnedMessages?.length) return active.pinnedMessages;
    if (active.pinnedMessageId) {
      return [{ id: active.pinnedMessageId, body: active.pinnedMessage || "Pinned message" }];
    }
    return [];
  }, [active]);
  const pinnedIdSet = useMemo(() => new Set(pinnedList.map((p) => p.id)), [pinnedList]);

  const pinnedThreadMessages = useMemo(() => {
    const byId = new Map(activeMessages.map((m) => [m.id, m]));
    return pinnedList.map((p) => {
      const loaded = byId.get(p.id);
      if (loaded) return loaded;
      return {
        id: p.id,
        conversationId: active?.id || "",
        senderId: "",
        content: p.body || "Pinned message",
        type: p.type || "text",
        createdAt: "",
        mine: false,
      } as Message;
    });
  }, [pinnedList, activeMessages, active?.id]);

  useEffect(() => {
    if (pinsListOpen && pinnedList.length === 0) setPinsListOpen(false);
  }, [pinsListOpen, pinnedList.length]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionMenu) return [];
    const q = mentionMenu.query.toLowerCase();
    const specials =
      isGroup && (!q || "everyone".startsWith(q) || "all".startsWith(q))
        ? [
          {
            userId: "__everyone__",
            username: "everyone",
            displayName: "Notify everyone",
            avatarUrl: undefined as string | undefined,
          },
        ]
        : [];
    const people = mentionMembers.filter((m) => {
      if (!q) return true;
      return (
        m.username.toLowerCase().startsWith(q) ||
        m.displayName.toLowerCase().includes(q)
      );
    });
    return [...specials, ...people].slice(0, 8);
  }, [mentionMenu, mentionMembers, isGroup]);

  function updateMentionMenu(value: string, cursor: number) {
    const before = value.slice(0, cursor);
    const m = before.match(/(^|[\s([{])@([a-zA-Z0-9_]*)$/);
    if (!m || !isGroup) {
      setMentionMenu(null);
      return;
    }
    setMentionMenu({
      query: m[2] || "",
      start: cursor - (m[2]?.length ?? 0) - 1,
      index: 0,
    });
  }

  function applyMention(username: string) {
    if (!mentionMenu) return;
    const el = draftRef.current;
    const cursor = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, mentionMenu.start);
    const after = draft.slice(cursor);
    const insert = `@${username} `;
    const next = before + insert + after;
    setDraft(next);
    setMentionMenu(null);
    window.setTimeout(() => {
      const pos = before.length + insert.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    }, 0);
  }
  const mobilePane: "list" | "chat" =
    narrowLayout && mobileChatOpen && active ? "chat" : "list";

  function openChat(convId: string) {
    chat.openConversation(convId);
    setMobileChatOpen(true);
  }

  function backToConversationList() {
    if (showDetails) {
      setShowDetails(false);
      return;
    }
    if (showInChatSearch) {
      setShowInChatSearch(false);
      setInChatSearch("");
      return;
    }
    if (selectMode) {
      clearSelection();
      return;
    }
    setMobileChatOpen(false);
    setMainMenuOpen(false);
  }

  // Entering narrow width: show chat if a conversation is already open.
  useEffect(() => {
    if (narrowLayout && !wasNarrowRef.current) {
      setMobileChatOpen(!!chat.activeId);
    }
    wasNarrowRef.current = narrowLayout;
  }, [narrowLayout, chat.activeId]);

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
    const limitErr = avatarLimitError(file);
    if (limitErr) {
      logChatError(limitErr);
      return;
    }
    setAvatarBusy(true);
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
      logChatError(err.message);
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
      logChatError(err.message);
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
      logChatError(err.message);
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
  const ctxMsg = ctxMenu
    ? activeMessages.find((m) => m.id === ctxMenu.msgId) ??
      pinnedThreadMessages.find((m) => m.id === ctxMenu.msgId) ??
      null
    : null;

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

  async function joinCompany() {
    const code = joinInvite.trim();
    if (!code || joinBusy) return;
    setJoinBusy(true);
    setJoinError(null);
    setJoinNotice(null);
    try {
      const device = await getAuthDevice();
      const body = await api<any>("/v1/enterprises/join", {
        method: "POST",
        body: JSON.stringify({
          invite_code: code,
          device_type: device.deviceType,
          device_name: device.deviceName,
          device_id: device.deviceId,
          platform: device.platform,
        }),
      });
      if (body?.access_token) {
        setTokens(String(body.access_token), String(body.refresh_token || getRefreshToken() || ""), true);
      }
      const name = String(body?.name || "company");
      setJoinNotice(
        body?.already_member ? `Already in ${name}` : `Joined ${name}`
      );
      setJoinInvite("");
      await chat.reload();
      window.setTimeout(() => {
        setJoinCompanyOpen(false);
        setJoinNotice(null);
      }, 900);
    } catch (e: any) {
      setJoinError(e?.message || "Could not join");
    } finally {
      setJoinBusy(false);
    }
  }

  async function logout() {
    try {
      await unregisterWebPush();
    } catch {
      /* stale endpoints are pruned after 404/410 */
    }
    await api("/v1/auth/logout", { method: "POST" }).catch(() => { });
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
      .catch(() => { });
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

  // Prefetch group members for @ autocomplete while composing.
  useEffect(() => {
    setMentionMenu(null);
    if (!active || (active.type !== "social_group" && active.type !== "group")) {
      setMentionMembers([]);
      return;
    }
    let cancelled = false;
    api<any>(`/v1/groups/${active.id}`)
      .then((g) => {
        if (cancelled) return;
        const meId = chat.me?.id;
        const list = Array.isArray(g?.members) ? g.members : [];
        setMentionMembers(
          list
            .filter((m: any) => String(m?.user_id ?? "") !== meId)
            .map((m: any) => ({
              userId: String(m?.user_id ?? ""),
              username: String(m?.username ?? ""),
              displayName: String(m?.display_name ?? m?.username ?? ""),
              avatarUrl: m?.avatar_url ? String(m.avatar_url) : undefined,
            }))
            .filter((m: { username: string }) => m.username)
        );
      })
      .catch(() => {
        if (!cancelled) setMentionMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.type, chat.me?.id]);

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
    // Deep-link ?c=<conversationId> without useSearchParams (avoids Suspense hang).
    const c = new URLSearchParams(window.location.search).get("c");
    if (c && c !== openedFromQuery.current) {
      openedFromQuery.current = c;
      openConversation(c);
      setMobileChatOpen(true);
    }
  }, [openConversation]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeMessages.length, chat.activeId]);

  function updateJumpBottomVisibility() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    nearBottomRef.current = near;
    setShowJumpBottom(!near && el.scrollHeight > el.clientHeight + 40);

    if (pinnedList.length === 0) {
      setBarPin(null);
      return;
    }
    const scrollRect = el.getBoundingClientRect();
    const tops: Record<string, number> = {};
    for (const p of pinnedList) {
      const node = document.getElementById(`msg-${p.id}`);
      if (!node) continue;
      // Position relative to scroll content (offsetTop can be wrong with nested layout).
      tops[p.id] = node.getBoundingClientRect().top - scrollRect.top + el.scrollTop;
    }
    const focusY = el.scrollTop + Math.min(120, el.clientHeight * 0.25);
    const next = nextPinnedFromScroll(pinnedList, focusY, tops);
    setBarPin(next);
  }

  function jumpToBottom() {
    nearBottomRef.current = true;
    setShowJumpBottom(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  function jumpToPinnedId(id: string, opts?: { syncBar?: boolean }) {
    const el = document.getElementById(`msg-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("msg-highlight");
    window.setTimeout(() => el?.classList.remove("msg-highlight"), 1600);
    if (opts?.syncBar !== false) {
      window.setTimeout(() => updateJumpBottomVisibility(), 400);
    }
  }

  function jumpPinnedBar() {
    const target = barPin ?? pinnedList[pinnedList.length - 1];
    if (!target) return;
    // Don't re-sync from scroll mid-animation — bar already advances to previous.
    jumpToPinnedId(target.id, { syncBar: false });
    const prev = previousPinnedInCycle(pinnedList, target.id);
    if (prev) setBarPin(prev);
  }

  useEffect(() => {
    if (pinnedList.length === 0) {
      setBarPin(null);
      return;
    }
    setBarPin((prev) => {
      if (prev && pinnedList.some((p) => p.id === prev.id)) return prev;
      return pinnedList[pinnedList.length - 1];
    });
    // Sync once messages/layout are ready.
    const t = window.setTimeout(() => updateJumpBottomVisibility(), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.activeId, pinnedList.map((p) => p.id).join(",")]);

  useEffect(() => {
    setSelectedIds(new Set());
    nearBottomRef.current = true;
    setShowJumpBottom(false);
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

  // Mattermost focus_post_textbox / useTextboxFocus: focus composer so the user
  // can type immediately after picking a DM or group in the sidebar.
  useEffect(() => {
    if (!chat.activeId || recording || voiceBusy) return;
    const id = window.setTimeout(() => draftRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [chat.activeId, recording, voiceBusy]);

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

  async function attachDroppedFiles(convId: string, files: File[]) {
    if (!convId || files.length === 0) return;
    setDropHoverConvId(null);
    setChatDropActive(false);
    chatDropDepthRef.current = 0;
    if (chat.activeId !== convId) {
      chat.openConversation(convId);
      setMobileChatOpen(true);
    }
    await openMediaDraft(files);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !chat.activeId) return;
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
        logChatError(e.message);
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
    } catch {
      // Error is shown on the failed message bubble.
    }
  }

  function mediaDraftTitle(mode: "photos" | "files", n: number): string {
    if (mode === "photos") {
      return n === 1 ? "Send Photo" : `Send ${n} Photos`;
    }
    return n === 1 ? "Send File" : `Send ${n} files`;
  }

  async function openMediaDraft(files: File[], opts?: { append?: boolean }) {
    if (!chat.activeId || editingMessage || files.length === 0) return;
    const accepted: File[] = [];
    let limitErr: string | null = null;
    for (const file of files) {
      const err = attachmentLimitError(file);
      if (err) {
        limitErr = err;
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) {
      logChatError(limitErr || "File too large");
      return;
    }
    if (limitErr) logChatError(limitErr);

    if (opts?.append) {
      const imageFiles = accepted.filter((f) => f.type.startsWith("image/"));
      if (!imageFiles.length) return;
      const additions: { file: File; url: string }[] = [];
      for (const file of imageFiles) {
        additions.push({ file, url: await makeImagePreviewUrl(file) });
      }
      setMediaDraft((prev) => {
        if (!prev || prev.mode !== "photos") {
          additions.forEach((it) => {
            if (it.url) URL.revokeObjectURL(it.url);
          });
          return prev;
        }
        return { ...prev, items: [...prev.items, ...additions] };
      });
      window.setTimeout(() => mediaCaptionRef.current?.focus(), 0);
      return;
    }

    const mode: "photos" | "files" = accepted.every((f) => f.type.startsWith("image/"))
      ? "photos"
      : "files";
    const items: { file: File; url: string }[] = [];
    for (const file of accepted) {
      items.push({
        file,
        url: file.type.startsWith("image/") ? await makeImagePreviewUrl(file) : "",
      });
    }
    setMediaDraft((prev) => {
      prev?.items.forEach((it) => {
        if (it.url) URL.revokeObjectURL(it.url);
      });
      return {
        items,
        mode,
        caption: draft,
        replyToId: replyTo?.id,
      };
    });
    // Composer text rides along as caption / leading message.
    setDraft("");
    if (chat.activeId) {
      saveDraft(chat.activeId, "");
      chat.stopTyping(chat.activeId);
    }
    setReplyTo(null);
    window.setTimeout(() => mediaCaptionRef.current?.focus(), 0);
  }

  function closeMediaDraft(opts?: { restoreCaption?: boolean }) {
    setMediaDraft((prev) => {
      prev?.items.forEach((it) => {
        if (it.url) URL.revokeObjectURL(it.url);
      });
      if (opts?.restoreCaption && prev?.caption) {
        setDraft(prev.caption);
        if (chat.activeId) saveDraft(chat.activeId, prev.caption);
      }
      return null;
    });
    setMediaSending(false);
    window.setTimeout(() => draftRef.current?.focus(), 0);
  }

  async function confirmSendMedia() {
    if (!mediaDraft || !chat.activeId || mediaSending) return;
    setMediaSending(true);
    const convId = chat.activeId;
    const { items, mode, caption, replyToId } = mediaDraft;
    const trimmed = caption.trim();
    // Close the modal immediately so the UI stays responsive while XHR streams.
    setMediaDraft(null);
    setMediaSending(false);
    window.setTimeout(() => draftRef.current?.focus(), 0);
    try {
      if (mode === "files" && trimmed) {
        await chat.sendMessage(convId, trimmed, replyToId);
      }
      for (let i = 0; i < items.length; i++) {
        const file = items[i].file;
        const isFirst = i === 0;
        const fileReply = mode === "files" && trimmed ? undefined : isFirst ? replyToId : undefined;
        const fileCaption = mode === "photos" && isFirst ? trimmed : undefined;
        await chat.sendMediaMessage(convId, file, fileReply, fileCaption);
        if (items[i].url) URL.revokeObjectURL(items[i].url);
      }
    } catch (err: any) {
      items.forEach((it) => {
        if (it.url) URL.revokeObjectURL(it.url);
      });
      // Per-message error is already on the failed bubble via useChat.
    }
  }

  async function ingestClipboardImages(dt: DataTransfer | null | undefined) {
    if (!chat.activeId || recording || voiceBusy || editingMessage || mediaSending) return false;
    if (clipboardIngestLock.current) return false;
    clipboardIngestLock.current = true;
    try {
      // Prefer paste-event files only. clipboard.read() often returns the same
      // bitmap again and was doubling every Ctrl+V.
      let images = imagesFromClipboard(dt);
      if (!images.length) {
        images = await imagesFromClipboardApi();
      }
      if (!images.length) return false;
      if (mediaDraftRef.current?.mode === "photos") {
        openMediaDraft(images, { append: true }).catch(() => { });
      } else {
        openMediaDraft(images).catch(() => { });
      }
      return true;
    } finally {
      // Release on next tick so bubbled paste handlers in the same event are ignored.
      window.setTimeout(() => {
        clipboardIngestLock.current = false;
      }, 0);
    }
  }

  function onComposerPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!chat.activeId || recording || voiceBusy || editingMessage) return;
    const syncImages = imagesFromClipboard(e.clipboardData);
    const types = e.clipboardData ? Array.from(e.clipboardData.types as ArrayLike<string>) : [];
    const maybeImage =
      syncImages.length > 0 ||
      types.includes("Files") ||
      types.some((t) => t.startsWith("image/"));
    if (!maybeImage) return;
    e.preventDefault();
    e.stopPropagation();
    void ingestClipboardImages(e.clipboardData);
  }

  function onMediaDraftPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const syncImages = imagesFromClipboard(e.clipboardData);
    const types = e.clipboardData ? Array.from(e.clipboardData.types as ArrayLike<string>) : [];
    const maybeImage =
      syncImages.length > 0 ||
      types.includes("Files") ||
      types.some((t) => t.startsWith("image/"));
    if (!maybeImage) return; // allow normal text paste into the caption
    e.preventDefault();
    e.stopPropagation();
    void ingestClipboardImages(e.clipboardData);
  }

  function removeMediaDraftItem(index: number) {
    setMediaDraft((prev) => {
      if (!prev) return prev;
      const items = prev.items.slice();
      const [removed] = items.splice(index, 1);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      if (items.length === 0) {
        if (prev.caption) {
          setDraft(prev.caption);
          if (chat.activeId) saveDraft(chat.activeId, prev.caption);
        }
        window.setTimeout(() => draftRef.current?.focus(), 0);
        return null;
      }
      const mode: "photos" | "files" = items.every((it) => it.file.type.startsWith("image/"))
        ? "photos"
        : "files";
      return { ...prev, items, mode };
    });
  }

  function startEdit(msg: Message) {
    setPinsListOpen(false);
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
    const durationSec = Math.min(
      VOICE_MAX_SEC,
      Math.max(1, Math.round((Date.now() - recordStartedRef.current) / 1000))
    );
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
    const replyId = replyTo?.id;
    setReplyTo(null);
    try {
      await chat.sendVoiceMessage(chat.activeId, blob, durationSec, replyId);
    } catch {
      // Error is shown on the failed voice bubble.
    } finally {
      setVoiceBusy(false);
    }
  }

  async function startRecording() {
    if (!chat.activeId || recording || voiceBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      logChatError("Voice messages are not supported in this browser");
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
      rec.start(250);
      recordTimerRef.current = setInterval(() => {
        setRecordSecs(
          Math.min(VOICE_MAX_SEC, Math.floor((Date.now() - recordStartedRef.current) / 1000))
        );
      }, 250);
      recordMaxRef.current = setTimeout(() => {
        finishRecording(true).catch(() => { });
      }, VOICE_MAX_SEC * 1000);
    } catch {
      stopMediaTracks();
      logChatError("Microphone permission denied");
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
    <AppShell rail={false} mobilePane={mobilePane}>
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
                  }).catch(() => { });
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
                        chat.openDM(u.id).then(() => setMobileChatOpen(true)).catch(() => { });
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
                        openChat(m.conversationId);
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
                  <button className="btn-ghost" onClick={chat.reload}>
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
                  dropHover={dropHoverConvId === c.id}
                  typing={chat.typingByConv[c.id] ?? []}
                  online={
                    c.peerId
                      ? chat.presenceByUser[c.peerId]?.online ?? c.peerOnline
                      : undefined
                  }
                  onClick={() => openChat(c.id)}
                  onFavorite={() =>
                    chat.updateConversationPrefs(c.id, { favorite: !c.favorite }).catch(() => { })
                  }
                  onMute={() =>
                    chat.updateConversationPrefs(c.id, { muted: !c.muted }).catch(() => { })
                  }
                  onDropHover={(hover) => setDropHoverConvId(hover ? c.id : null)}
                  onFilesDrop={(files) => {
                    attachDroppedFiles(c.id, files).catch(() => { });
                  }}
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
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                setComposeOpen(false);
                setJoinError(null);
                setJoinNotice(null);
                setJoinCompanyOpen(true);
              }}
            >
              <MenuIcon d={ICONS.building} />
              Join a company
            </button>
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
            {pinsListOpen ? (
              <div className="chat-header">
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title="Back to chat"
                  aria-label="Back to chat"
                  onClick={() => setPinsListOpen(false)}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">Pinned messages</div>
                  <div className="sub">
                    {pinnedList.length} pin{pinnedList.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            ) : selectMode ? (
              <div className="chat-header select-bar">
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title="Back to chats"
                  onClick={backToConversationList}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
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
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title="Back to chats"
                  onClick={backToConversationList}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
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
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title="Back to chats"
                  onClick={backToConversationList}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
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
                        call
                          .startCall(active.id, "voice", conversationDisplayName(active))
                          .catch((e) => logChatError(e.message));
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
                        call
                          .startCall(active.id, "video", conversationDisplayName(active))
                          .catch((e) => logChatError(e.message));
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

            {pinnedList.length > 0 && !pinsListOpen && (
              <div className="pinned-banner">
                <div className="pinned-accent" aria-hidden />
                <button
                  type="button"
                  className="pinned-banner-main"
                  title="Jump to next pinned message"
                  onClick={jumpPinnedBar}
                >
                  <div className="pinned-label">
                    Pinned Message
                    {pinnedList.length > 1 ? ` · ${pinnedList.length}` : ""}
                  </div>
                  <div className="pinned-text">
                    {(barPin ?? pinnedList[pinnedList.length - 1])?.body || "Pinned message"}
                  </div>
                </button>
                <button
                  type="button"
                  className="pinned-list-btn"
                  title="Pinned messages"
                  aria-label="Pinned messages"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinsListOpen(true);
                  }}
                >
                  <MenuIcon d={ICONS.pinList} style={{ width: 18, height: 18 }} />
                </button>
              </div>
            )}

            <div
              className={`chat-drop-zone ${chatDropActive ? "is-active" : ""}`}
              onDragEnter={(e) => {
                if (!dataTransferHasFiles(e.dataTransfer) || !chat.activeId) return;
                e.preventDefault();
                e.stopPropagation();
                chatDropDepthRef.current += 1;
                setChatDropActive(true);
              }}
              onDragOver={(e) => {
                if (!dataTransferHasFiles(e.dataTransfer) || !chat.activeId) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(e) => {
                if (!dataTransferHasFiles(e.dataTransfer)) return;
                e.stopPropagation();
                chatDropDepthRef.current = Math.max(0, chatDropDepthRef.current - 1);
                if (chatDropDepthRef.current === 0) setChatDropActive(false);
              }}
              onDrop={(e) => {
                if (!dataTransferHasFiles(e.dataTransfer) || !chat.activeId) return;
                e.preventDefault();
                e.stopPropagation();
                chatDropDepthRef.current = 0;
                setChatDropActive(false);
                const files = filesFromDataTransfer(e.dataTransfer);
                if (files.length) {
                  attachDroppedFiles(chat.activeId, files).catch(() => { });
                }
              }}
            >
              {chatDropActive && (
                <div className="chat-drop-overlay" aria-hidden>
                  <div className="chat-drop-panel">
                    <div className="chat-drop-title">Drop files here to send them</div>
                    <div className="chat-drop-sub">without compression</div>
                  </div>
                </div>
              )}
              <div className="msg-scroll-wrap">
                <div
                  className="msg-scroll"
                  ref={pinsListOpen ? undefined : scrollRef}
                  onScroll={pinsListOpen ? undefined : updateJumpBottomVisibility}
                >
                  {pinsListOpen ? (
                    <>
                      {pinnedThreadMessages.length === 0 && (
                        <div className="empty-state" style={{ minHeight: 200 }}>
                          <div className="muted">No pinned messages</div>
                        </div>
                      )}
                      {pinnedThreadMessages.map((m) => (
                        <div key={m.id} className="pins-thread-item">
                          <Bubble
                            msg={m}
                            isGroup={!!isGroup}
                            replyPreview={previewFor(m)}
                            selectMode={selectMode}
                            selected={selectedIds.has(m.id)}
                            selectable={!m.pending && !m.failed}
                            pinned
                            onToggleSelect={() => toggleSelect(m.id)}
                            onContextMenu={(e) => openCtxMenu(e, m)}
                            ctxOpen={!!ctxMenu && ctxMenu.msgId === m.id}
                            onReact={
                              chat.activeId
                                ? (emoji) => chat.reactMessage(m.id, chat.activeId!, emoji).catch(() => { })
                                : undefined
                            }
                          />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
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
                            pinned={pinnedIdSet.has(m.id)}
                            onToggleSelect={() => toggleSelect(m.id)}
                            onContextMenu={(e) => openCtxMenu(e, m)}
                            ctxOpen={!!ctxMenu}
                            onReact={
                              chat.activeId
                                ? (emoji) => chat.reactMessage(m.id, chat.activeId!, emoji).catch(() => { })
                                : undefined
                            }
                            onRetry={
                              m.failed && chat.activeId
                                ? () => chat.retryMessage(chat.activeId!, m)
                                : undefined
                            }
                            onCancelUpload={
                              m.pending &&
                                typeof m.uploadProgress === "number" &&
                                chat.activeId
                                ? () => chat.cancelUpload(chat.activeId!, m)
                                : undefined
                            }
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {!pinsListOpen && showJumpBottom && (
                  <button
                    type="button"
                    className="jump-bottom-btn"
                    title="Scroll to bottom"
                    aria-label="Scroll to bottom"
                    onClick={jumpToBottom}
                  >
                    <MenuIcon d={ICONS.back} style={{ width: 18, height: 18, transform: "rotate(-90deg)" }} />
                  </button>
                )}
              </div>
              {!pinsListOpen && (
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
                        {mentionMenu && mentionSuggestions.length > 0 && (
                          <div className="mention-menu" role="listbox">
                            {mentionSuggestions.map((m, i) => (
                              <button
                                key={m.userId + m.username}
                                type="button"
                                className={`mention-option ${i === mentionMenu.index ? "active" : ""}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  applyMention(m.username);
                                }}
                              >
                                {m.userId !== "__everyone__" && (
                                  <Avatar name={m.displayName} url={m.avatarUrl} size={28} />
                                )}
                                <span className="mention-option-text">
                                  <strong>@{m.username}</strong>
                                  <span className="muted">{m.displayName}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="*/*"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const list = e.target.files ? Array.from(e.target.files) : [];
                            e.target.value = "";
                            if (!list.length || !chat.activeId) return;
                            openMediaDraft(list).catch(() => { });
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
                          placeholder={isGroup ? "Message · try @name" : "Message"}
                          value={draft}
                          disabled={voiceBusy}
                          onChange={(e) => {
                            const value = e.target.value;
                            const cursor = e.target.selectionStart ?? value.length;
                            setDraft(value);
                            updateMentionMenu(value, cursor);
                            if (!chat.activeId) return;
                            if (value.trim()) chat.notifyTyping(chat.activeId);
                            else chat.stopTyping(chat.activeId);
                          }}
                          onClick={(e) => {
                            const t = e.currentTarget;
                            updateMentionMenu(t.value, t.selectionStart ?? t.value.length);
                          }}
                          onPaste={onComposerPaste}
                          onKeyDown={(e) => {
                            if (mentionMenu && mentionSuggestions.length > 0) {
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setMentionMenu((prev) =>
                                  prev
                                    ? {
                                      ...prev,
                                      index: (prev.index + 1) % mentionSuggestions.length,
                                    }
                                    : prev
                                );
                                return;
                              }
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setMentionMenu((prev) =>
                                  prev
                                    ? {
                                      ...prev,
                                      index:
                                        (prev.index - 1 + mentionSuggestions.length) %
                                        mentionSuggestions.length,
                                    }
                                    : prev
                                );
                                return;
                              }
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                const pick = mentionSuggestions[mentionMenu.index];
                                if (pick) applyMention(pick.username);
                                return;
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setMentionMenu(null);
                                return;
                              }
                            }
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
              )}
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
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadGroupAvatar(f).catch(() => { });
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
                    onClick={() => saveGroupMeta().catch(() => { })}
                  >
                    {groupMetaBusy ? "Saving…" : "Save group info"}
                  </button>
                  <label className="group-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(groupDetails.forbid_member_friend_add)}
                      disabled={groupMetaBusy}
                      onChange={() => toggleForbidFriendAdd().catch(() => { })}
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
                              onClick={() => muteMember(m.user_id, "10m").catch(() => { })}
                            >
                              10m
                            </button>
                            <button
                              type="button"
                              className="btn-ghost mute-chip"
                              onClick={() => muteMember(m.user_id, "1h").catch(() => { })}
                            >
                              1h
                            </button>
                            <button
                              type="button"
                              className="btn-ghost mute-chip"
                              onClick={() => muteMember(m.user_id, "permanent").catch(() => { })}
                            >
                              Mute
                            </button>
                            {isMuted && (
                              <button
                                type="button"
                                className="btn-ghost mute-chip"
                                onClick={() => muteMember(m.user_id, "off").catch(() => { })}
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
                      onClick={() => muteMember("", "all_off").catch(() => { })}
                    >
                      Unmute whole group
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => muteMember("", "all").catch(() => { })}
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
                chat.updateConversationPrefs(active.id, { muted: !active.muted }).catch(() => { })
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
                    chat.reactMessage(ctxMsg.id, chat.activeId!, em).catch(() => { });
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
                  setPinsListOpen(false);
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
                setPinsListOpen(false);
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
                    const pinned = pinnedIdSet.has(ctxMsg.id);
                    chat.pinMessage(ctxMsg.id, chat.activeId!, !pinned).catch(() => { });
                    setCtxMenu(null);
                  }}
                >
                  <MenuIcon d={ICONS.pin} />
                  {pinnedIdSet.has(ctxMsg.id) ? "Unpin" : "Pin"}
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
                  const pinned = pinnedIdSet.has(ctxMsg.id);
                  chat.pinMessage(ctxMsg.id, chat.activeId!, !pinned).catch(() => { });
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.pin} />
                {pinnedIdSet.has(ctxMsg.id) ? "Unpin" : "Pin"}
              </button>
            )}
          </div>
        </div>
      )}

      {joinCompanyOpen && (
        <div
          className="forward-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Join a company"
          onClick={() => {
            if (!joinBusy) {
              setJoinCompanyOpen(false);
              setJoinError(null);
              setJoinNotice(null);
            }
          }}
        >
          <form
            className="forward-modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              joinCompany().catch(() => {});
            }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Join a company</h3>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              Enter the invite code from your organization admin.
            </p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="join-invite">Invite code</label>
              <input
                id="join-invite"
                value={joinInvite}
                onChange={(e) => setJoinInvite(e.target.value.toUpperCase())}
                placeholder="ACME2026"
                autoFocus
                autoComplete="off"
                disabled={joinBusy}
              />
            </div>
            {joinError && <div className="error-text">{joinError}</div>}
            {joinNotice && <div className="muted" style={{ marginBottom: 8 }}>{joinNotice}</div>}
            <div className="forward-modal-actions">
              <button
                className="btn-ghost"
                type="button"
                disabled={joinBusy}
                onClick={() => {
                  setJoinCompanyOpen(false);
                  setJoinError(null);
                  setJoinNotice(null);
                }}
              >
                Cancel
              </button>
              <button className="btn" type="submit" disabled={joinBusy || !joinInvite.trim()}>
                {joinBusy ? "Joining…" : "Join"}
              </button>
            </div>
          </form>
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
      {mediaDraft && (
        <div
          className="photo-send-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={mediaDraftTitle(mediaDraft.mode, mediaDraft.items.length)}
          onClick={(e) => {
            if (e.target === e.currentTarget && !mediaSending) {
              closeMediaDraft({ restoreCaption: true });
            }
          }}
        >
          <div className="photo-send-modal">
            <header className="photo-send-header">
              <button
                type="button"
                className="photo-send-close"
                title="Cancel"
                disabled={mediaSending}
                onClick={() => closeMediaDraft({ restoreCaption: true })}
              >
                {"\u2715"}
              </button>
              <h2>{mediaDraftTitle(mediaDraft.mode, mediaDraft.items.length)}</h2>
              <span className="photo-send-header-spacer" />
            </header>
            {mediaDraft.mode === "photos" ? (
              <div
                className={`photo-send-preview ${mediaDraft.items.length > 1 ? "photo-send-preview-grid" : ""
                  }`}
              >
                {mediaDraft.items.map((it, idx) => (
                  <div key={`${it.file.name}-${idx}`} className="photo-send-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt={it.file.name || `Photo ${idx + 1}`} />
                    <button
                      type="button"
                      className="photo-send-remove"
                      title="Remove"
                      disabled={mediaSending}
                      onClick={() => removeMediaDraftItem(idx)}
                    >
                      {"\u2715"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="file-send-list">
                {mediaDraft.items.map((it, idx) => (
                  <li key={`${it.file.name}-${idx}`} className="file-send-row">
                    <MenuIcon d={ICONS.paperclip} style={{ width: 18, height: 18 }} />
                    <span className="file-send-name" title={it.file.name}>
                      {it.file.name || `file-${idx + 1}`}
                    </span>
                    <button
                      type="button"
                      className="photo-send-remove inline"
                      title="Remove"
                      disabled={mediaSending}
                      onClick={() => removeMediaDraftItem(idx)}
                    >
                      {"\u2715"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="photo-send-composer">
              <textarea
                ref={mediaCaptionRef}
                rows={1}
                placeholder={
                  mediaDraft.mode === "photos" ? "Add a caption…" : "Add a message…"
                }
                value={mediaDraft.caption}
                disabled={mediaSending}
                onPaste={onMediaDraftPaste}
                onChange={(e) =>
                  setMediaDraft((prev) => (prev ? { ...prev, caption: e.target.value } : prev))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    confirmSendMedia();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (!mediaSending) closeMediaDraft({ restoreCaption: true });
                  }
                }}
              />
              <button
                type="button"
                className="send-btn"
                title="Send"
                disabled={mediaSending}
                onClick={() => confirmSendMedia()}
              >
                {"\u27A4"}
              </button>
            </div>
          </div>
        </div>
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
            onClick={() => submit().catch(() => { })}
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
