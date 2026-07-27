"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import CallOverlay from "@/components/CallOverlay";
import ConfirmDialog, { type ConfirmRequest } from "@/components/ConfirmDialog";
import FriendNoteEditor from "@/components/FriendNoteEditor";
import GroupQr from "@/components/GroupQr";
import MessageBody from "@/components/MessageBody";
import { api, clearToken, mediaAuthURL, setTokens, getRefreshToken } from "@/lib/api";
import { getAuthDevice } from "@/lib/device";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatTypingLabel, useChat, type TypingUser } from "@/lib/useChat";
import { useCall } from "@/lib/useCall";
import { Conversation, Message, conversationDisplayName, formatLastSeen } from "@/lib/types";
import { useTheme } from "@/lib/theme";
import { useLocale } from "@/lib/locale";
import { localizeChatLabel, isDefaultPhotoLabel } from "@/lib/localizeChatLabel";
import { useDesktopIdleStatus } from "@/lib/useDesktopIdleStatus";
import { useGlobalSearch } from "@/lib/useSearch";
import { getDraft, saveDraft } from "@/lib/drafts";
import { dataTransferHasFiles, filesFromDataTransfer, imagesFromClipboard, imagesFromClipboardApi } from "@/lib/fileDrop";
import { makeImagePreviewUrl } from "@/lib/mediaPreview";
import {
  nextPinnedFromScroll,
  previousPinnedInCycle,
  type PinnedMessage,
} from "@/lib/pinnedCycle";
import {
  attachmentLimitError,
  avatarLimitError,
  AVATAR_ACCEPT,
  VOICE_MAX_SEC,
  MESSAGE_MAX_CHARS,
  messageCharCount,
  clipMessageText,
  isVideoAttachmentHint,
  isVideoMime,
} from "@/lib/mediaLimits";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { unregisterWebPush } from "@/lib/webPush";
import ShellConnectionBanner from "@/components/ShellConnectionBanner";

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
  onMarkUnread,
  onBlock,
  onClearHistory,
  onDelete,
  onOpenNewWindow,
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
  onMarkUnread: () => void;
  onBlock?: () => void;
  onClearHistory: () => void;
  onDelete: () => void;
  onOpenNewWindow: () => void;
  onDropHover?: (hover: boolean) => void;
  onFilesDrop?: (files: File[]) => void;
}) {
  const { t } = useLocale();
  const typingLabel = formatTypingLabel(typing, t);
  const isDM = conv.type === "dm";
  const isGroup = conv.type === "social_group" || conv.type === "group";
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
        const pad = 8;
        const menuW = 240;
        const menuH = 320;
        const x = Math.min(e.clientX, window.innerWidth - menuW - pad);
        const y = Math.min(e.clientY, window.innerHeight - menuH - pad);
        setMenu({ x: Math.max(pad, x), y: Math.max(pad, y) });
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
            {conv.favorite ? <span className="fav-mark" title={t("chat.favorite")}>★ </span> : null}
            {conversationDisplayName(conv)}
            {conv.muted ? <span className="mute-mark" title={t("chat.muted")}> · {t("chat.muted")}</span> : null}
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
                    {conv.lastMessageMine ? t("chat.you") : conv.lastMessageSender}:{" "}
                  </span>
                )}
                {localizeChatLabel(conv.lastMessage, t)}
              </>
            ) : (
              <span className="muted">{t("chat.noMessagesYet")}</span>
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
              onOpenNewWindow();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.openWindow} />
            {t("ctx.openInNewWindow")}
          </button>
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              onFavorite();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.pin} />
            {conv.favorite ? t("ctx.unpinChat") : t("ctx.pinChat")}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              onMute();
              setMenu(null);
            }}
          >
            <MenuIcon d={conv.muted ? ICONS.unmute : ICONS.mute} />
            {conv.muted ? t("ctx.unmuteNotifications") : t("ctx.muteNotifications")}
          </button>
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              onMarkUnread();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.markUnread} />
            {t("ctx.markAsUnread")}
          </button>
          {isDM && onBlock && (
            <button
              className="ctx-item"
              onClick={() => {
                onBlock();
                setMenu(null);
              }}
            >
              <MenuIcon d={ICONS.block} />
              {t("ctx.blockUser")}
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              onClearHistory();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.clearHistory} />
            {t("ctx.clearHistory")}
          </button>
          <button
            className="ctx-item danger"
            onClick={() => {
              onDelete();
              setMenu(null);
            }}
          >
            <MenuIcon d={ICONS.trash} />
            {isGroup ? t("ctx.leaveChat") : t("ctx.deleteChat")}
          </button>
        </div>
      )}
    </div>
  );
}

function receiptMark(msg: Message): ReactNode {
  // JD / WeChat-style: ⏳ sending → ✓ sent/delivered → ✓✓ read
  if (msg.pending) return " \u23F3";
  if (msg.failed) return " !";
  if (!msg.mine || msg.recalled) return "";
  if (msg.memberCount != null && msg.memberCount > 0) {
    const n = msg.readCount ?? msg.readBy?.length ?? 0;
    return ` ${n}/${msg.memberCount}`;
  }
  if (msg.read) return <span className="receipt-tick read">{" \u2713\u2713"}</span>;
  return <span className="receipt-tick">{" \u2713"}</span>;
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
  /** Chevron right — show conversation list when sidebar is collapsed. */
  forwardChevron: "M9 18l6-6-6-6",
  pencil: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  idCard:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5.5 16.5c.6-1.6 1.9-2.5 3.5-2.5s2.9.9 3.5 2.5 M15 10h4 M15 14h3",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  // Telegram-style main-menu icons (gear / moon / globe / status face).
  settings:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.4a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  theme: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  themeSun:
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42",
  language:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z",
  status:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 14s1.5 2 4 2 4-2 4-2 M9 9v1.2 M15 9v1.2",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 11a7 7 0 0 1-14 0 M12 18v4",
  stop: "M6 6h12v12H6z",
  paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  smile:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01",
  pin: "M12 17v5 M9 10.76V3h6v7.76L19 14v1H5v-1l4-3.24z",
  /** Pin + list affordance for opening the pinned messages panel. */
  pinList:
    "M12 2v8l3 3H9l3-3V2z M8 14h8 M8 17h6 M8 20h4 M5 12.5V22h14V12.5",
  mute: "M11 5L6 9H2v6h4l5 4V5z M23 9l-6 6 M17 9l6 6",
  unmute: "M11 5L6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14",
  openWindow: "M10 4h10a2 2 0 0 1 2 2v10h-2V6H10V4z M4 8h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
  markUnread: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z M17.5 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  block: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M4.9 4.9l14.2 14.2",
  clearHistory: "M4 20h16 M8 20V9l-2.5-3h13L16 9v11 M10 12v5 M14 12v5 M12 3v3",
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

/** Built-in composer emoji set (requirements: no custom sticker packs). */
const COMPOSER_EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘",
  "😎", "🤔", "🙄", "😢", "😭", "😡", "👍", "👎",
  "👏", "🙏", "🔥", "❤️", "💯", "🎉", "✨", "⭐",
  "🤝", "💪", "🫡", "🥳", "😴", "🤯", "😅", "😇",
  "😮", "🤗", "😏", "😜", "🤩", "💔", "👌", "✌️",
] as const;

function Bubble({
  msg,
  isGroup,
  peerName,
  peerAvatar,
  myName,
  myAvatar,
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
  onReplyPreviewClick,
  ctxOpen,
}: {
  msg: Message;
  isGroup: boolean;
  peerName?: string;
  peerAvatar?: string;
  myName?: string;
  myAvatar?: string;
  replyPreview?: { name: string; body: string };
  selectMode: boolean;
  selected: boolean;
  selectable: boolean;
  pinned?: boolean;
  onToggleSelect?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  onReact?: (emoji: string) => void;
  onRetry?: () => void;
  onCancelUpload?: () => void;
  onReplyPreviewClick?: (replyToId: string) => void;
  ctxOpen: boolean;
}) {
  const { t } = useLocale();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const canReact = !!onReact && !selectMode && !msg.recalled && !msg.pending && !msg.failed && !ctxOpen;
  // Recommend the message's top reaction if it has one, otherwise the default quick emoji.
  const recommendedEmoji = msg.reactions?.[0]?.emoji ?? QUICK_EMOJIS[0];
  const hasReactions = !msg.recalled && (msg.reactions?.length ?? 0) > 0;
  const canCancelUpload =
    !selectMode &&
    msg.pending &&
    typeof msg.uploadProgress === "number" &&
    !!onCancelUpload;

 // Align with caller (Calls history): mine = I placed the call → right.
  if (msg.type === "call") {
    const avatarName = msg.mine
      ? myName || msg.senderName || "You"
      : msg.senderName || peerName || "User";
    const avatarUrl = msg.mine
      ? myAvatar || msg.senderAvatar
      : msg.senderAvatar || peerAvatar;
    return (
      <div className={`msg-row call-row ${msg.mine ? "mine" : ""}`}>
        {!msg.mine && (
          <div className="msg-avatar" aria-hidden>
            <Avatar name={avatarName} url={avatarUrl} size={34} />
          </div>
        )}
        <div className="bubble-wrap">
          <div className="bubble call-bubble">
            <span className="call-msg">
              {localizeChatLabel(msg.content, t, { type: "call" }) || t("chat.call")}
            </span>
            <span className="meta">{fmtTime(msg.createdAt)}</span>
          </div>
        </div>
        {msg.mine && (
          <div className="msg-avatar" aria-hidden>
            <Avatar name={avatarName} url={avatarUrl} size={34} />
          </div>
        )}
      </div>
    );
  }

  const meta = (
    <span className="meta">
      {pinned && !msg.recalled && (
        <span className="pin-mark" title={t("chat.pinnedMessage")}>
          <MenuIcon d={ICONS.pin} style={{ width: 11, height: 11 }} />
        </span>
      )}
      {msg.recalled && (
        <span className="recall-mark" title={t("chat.wasRecalled")}>
          <MenuIcon d={ICONS.trash} style={{ width: 11, height: 11 }} />
        </span>
      )}
      {msg.editedAt && !msg.recalled && (
        <span className="edited-mark">{t("chat.edited")} </span>
      )}
      {fmtTime(msg.createdAt)}
      {receiptMark(msg)}
      {canCancelUpload && (
        <button
          type="button"
          className="msg-action-icon"
          title={t("chat.cancelUpload")}
          aria-label={t("chat.cancelUpload")}
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
          title={t("chat.retry")}
          aria-label={t("chat.retry")}
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
  const avatarName = msg.mine
    ? myName || msg.senderName || "You"
    : msg.senderName || peerName || "User";
  const avatarUrl = msg.mine
    ? myAvatar || msg.senderAvatar
    : msg.senderAvatar || peerAvatar;

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
          title={selected ? t("chat.deselect") : t("chat.select")}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
        >
          {selected ? "\u2713" : ""}
        </button>
      )}
      {!msg.mine && (
        <div className="msg-avatar" aria-hidden>
          <Avatar name={avatarName} url={avatarUrl} size={34} />
        </div>
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
          {replyPreview && !msg.recalled && msg.replyToId && (
            <div
              className={`reply-preview ${msg.mine ? "mine" : "peer"}`}
              role="button"
              tabIndex={0}
              title={t("chat.goToOriginal")}
              onClick={(e) => {
                e.stopPropagation();
                if (!selectMode) onReplyPreviewClick?.(msg.replyToId!);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!selectMode) onReplyPreviewClick?.(msg.replyToId!);
                }
              }}
            >
              <div className="reply-preview-name">{replyPreview.name}</div>
              <div className="reply-preview-text">{replyPreview.body}</div>
            </div>
          )}
          {msg.recalled && !msg.content && !msg.mediaUrl ? (
            <span className="recalled-placeholder">{t("chat.messageRecalled")}</span>
          ) : msg.type === "voice" && msg.mediaUrl && !msg.recalled ? (
            <div className="voice-msg">
              <audio controls preload="metadata" src={mediaAuthURL(msg.mediaUrl)} />
              <div className="voice-label">
                {localizeChatLabel(msg.content, t, { type: "voice" })}
              </div>
            </div>
          ) : msg.type === "image" && msg.mediaUrl && !msg.recalled ? (
            <div className="media-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaAuthURL(msg.mediaUrl)}
                alt={localizeChatLabel(msg.content, t, { type: "image" })}
              />
              {msg.content && !isDefaultPhotoLabel(msg.content) && (
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
            isVideoAttachmentHint(msg.content, msg.mediaUrl) ||
            isVideoMime(msg.localFile?.type) ? (
              <div className="media-video">
                {msg.mediaUrl && !msg.failed ? (
                  <video
                    controls
                    preload="metadata"
                    playsInline
                    src={mediaAuthURL(msg.mediaUrl)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : null}
                <div className="media-video-meta">
                  {msg.mediaUrl && !msg.failed ? (
                    <a
                      className="media-file"
                      href={mediaAuthURL(msg.mediaUrl)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MenuIcon d={ICONS.paperclip} style={{ width: 18, height: 18 }} />
                      <span>
                        {localizeChatLabel(msg.content, t, { type: "file" }) || t("chat.video")}
                      </span>
                    </a>
                  ) : (
                    <div className="media-file">
                      <MenuIcon d={ICONS.paperclip} style={{ width: 18, height: 18 }} />
                      <span>
                        {localizeChatLabel(msg.content, t, { type: "file" }) || t("chat.video")}
                      </span>
                    </div>
                  )}
                </div>
                {msg.pending && typeof msg.uploadProgress === "number" && (
                  <div className="upload-progress" aria-hidden>
                    <div
                      className="upload-progress-bar"
                      style={{ width: `${Math.round(msg.uploadProgress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
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
                  <span>{localizeChatLabel(msg.content, t, { type: "file" }) || t("chat.file")}</span>
                </a>
              ) : (
                <div className="media-file">
                  <MenuIcon d={ICONS.paperclip} style={{ width: 18, height: 18 }} />
                  <span>{localizeChatLabel(msg.content, t, { type: "file" }) || t("chat.file")}</span>
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
            )
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
        {msg.mine &&
          isGroup &&
          !msg.recalled &&
          !msg.pending &&
          msg.memberCount != null &&
          msg.memberCount > 0 && (
            <button
              type="button"
              className="receipt-detail-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setReceiptOpen((v) => !v);
              }}
            >
              {t("chat.readOfCount", {
                n: msg.readCount ?? 0,
                total: msg.memberCount,
              })}
              {receiptOpen ? " ▴" : " ▾"}
            </button>
          )}
        {receiptOpen && msg.mine && isGroup && (
          <div className="receipt-detail">
            <div className="receipt-col">
              <div className="receipt-col-title">{t("chat.read")}</div>
              {(msg.readBy?.length ?? 0) === 0 ? (
                <div className="muted">{t("chat.nobodyYet")}</div>
              ) : (
                msg.readBy!.map((u) => (
                  <div key={u.userId} className="receipt-user">
                    {u.displayName}
                  </div>
                ))
              )}
            </div>
            <div className="receipt-col">
              <div className="receipt-col-title">{t("chat.unread")}</div>
              {(msg.unreadBy?.length ?? 0) === 0 ? (
                <div className="muted">{t("chat.everyone")}</div>
              ) : (
                msg.unreadBy!.map((u) => (
                  <div key={u.userId} className="receipt-user">
                    {u.displayName}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {msg.mine && (
        <div className="msg-avatar" aria-hidden>
          <Avatar name={avatarName} url={avatarUrl} size={34} />
        </div>
      )}
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
  const call = useCall({
    meId: chat.me?.id,
    subscribe: chat.subscribeEvents,
    resolvePeerAvatar: (conversationId) =>
      chat.conversations.find((c) => c.id === conversationId)?.avatarUrl,
  });
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t, labelLocale, labelTheme } = useLocale();
  const [myStatus, setMyStatus] = useState<"online" | "away" | "dnd" | "offline">("online");
  const { noteManualStatusChange } = useDesktopIdleStatus(myStatus, setMyStatus);
  const { openConversation } = chat;
  const router = useRouter();
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [joinCompanyOpen, setJoinCompanyOpen] = useState(false);
  const [joinInvite, setJoinInvite] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  /** Narrow: list ↔ chat (Telegram-style), same on web and desktop. */
  const narrowLayout = useMediaQuery("(max-width: 768px)");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  /** Hide the conversation-list sidebar on wide layouts only. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const wasNarrowRef = useRef(false);
  const mobileChatOpenRef = useRef(false);
  mobileChatOpenRef.current = mobileChatOpen;
  const [query, setQuery] = useState("");
  /** Only show "Reconnecting" after a prior successful WS connect (avoid boot flicker). */
  const [wsEverConnected, setWsEverConnected] = useState(false);
  useEffect(() => {
    if (chat.connected) setWsEverConnected(true);
  }, [chat.connected]);
  const [inChatSearch, setInChatSearch] = useState("");
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
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
 /** Conversation id under file drag in the sidebar list (channel drop). */
  const [dropHoverConvId, setDropHoverConvId] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
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
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [addMemberFriends, setAddMemberFriends] = useState<
    { user_id: string; username: string; display_name: string; avatar_url?: string }[]
  >([]);
  const [addMemberLookup, setAddMemberLookup] = useState<
    { user_id: string; username: string; display_name: string; avatar_url?: string }[]
  >([]);
  const [addMemberQuery, setAddMemberQuery] = useState("");
  const [addMemberLookupBusy, setAddMemberLookupBusy] = useState(false);
  const [addMemberPicked, setAddMemberPicked] = useState<Set<string>>(new Set());
  const [addMemberProfiles, setAddMemberProfiles] = useState<
    Record<
      string,
      {
        user_id: string;
        username: string;
        display_name: string;
        avatar_url?: string;
        isFriend: boolean;
      }
    >
  >({});
  const [addMembersBusy, setAddMembersBusy] = useState(false);
  const [memberMenu, setMemberMenu] = useState<{
    x: number;
    y: number;
    member: {
      user_id: string;
      display_name: string;
      username: string;
      role: string;
      avatar_url?: string;
    };
  } | null>(null);
  const [dmPeerProfile, setDmPeerProfile] = useState<{
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
    real_name?: string;
    signature?: string;
    region?: string;
    online?: boolean;
    last_active_at?: string;
  } | null>(null);
 /** Members available for @ autocomplete (suggestion box). */
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
  const loadingOlderUIRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
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
  const draftChars = messageCharCount(draft);
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

  const MOBILE_PANE_STATE = "qchatMobilePane";

  function openChat(convId: string) {
    chat.openConversation(convId);
    if (narrowLayout && !mobileChatOpenRef.current) {
      try {
        window.history.pushState({ [MOBILE_PANE_STATE]: "chat" }, "");
      } catch {
        /* ignore quota / security errors */
      }
    }
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
    if (pinsListOpen) {
      setPinsListOpen(false);
      return;
    }
    if (
      narrowLayout &&
      mobileChatOpenRef.current &&
      typeof window !== "undefined" &&
      window.history.state?.[MOBILE_PANE_STATE] === "chat"
    ) {
      window.history.back();
      return;
    }
    setMobileChatOpen(false);
    setMainMenuOpen(false);
  }

  /** Wide only: toggle conversation list. Narrow: back to list (same as web). */
  function toggleSidebarMenu() {
    if (narrowLayout) {
      backToConversationList();
      return;
    }
    setSidebarCollapsed((v) => !v);
  }

  // Leaving a conversation while the list is hidden would trap the user.
  useEffect(() => {
    if (!chat.activeId && sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [chat.activeId, sidebarCollapsed]);

  // Entering narrow width: show chat if a conversation is already open.
  useEffect(() => {
    if (narrowLayout && !wasNarrowRef.current) {
      setSidebarCollapsed(false);
      if (chat.activeId) {
        setMobileChatOpen(true);
        try {
          if (window.history.state?.[MOBILE_PANE_STATE] !== "chat") {
            window.history.pushState({ [MOBILE_PANE_STATE]: "chat" }, "");
          }
        } catch {
          /* ignore */
        }
      }
    }
    wasNarrowRef.current = narrowLayout;
  }, [narrowLayout, chat.activeId]);

  // OS / browser back → leave chat pane (Telegram-style).
  useEffect(() => {
    const onPopState = () => {
      if (!wasNarrowRef.current) return;
      setShowDetails(false);
      setShowInChatSearch(false);
      setInChatSearch("");
      setPinsListOpen(false);
      setSelectedIds(new Set());
      setMobileChatOpen(false);
      setMainMenuOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectMode = selectedIds.size > 0;
  const selectedMessages = useMemo(
    () => activeMessages.filter((m) => selectedIds.has(m.id)),
    [activeMessages, selectedIds]
  );
  const myGroupRole = groupDetails?.role || chat.myRole || "";
  const isGroupOwner = myGroupRole === "owner";
  /** Group owner/admin may recall any message (API + permission matrix). */
  const canAdminRecall = isGroup && (myGroupRole === "owner" || myGroupRole === "admin");
  /** Groups reserve the pinned message for owner/admin; either side of a DM may pin. */
  const canPin = !isGroup || canAdminRecall;
  const canRecallMsg = (m: Message) =>
    Boolean(
      !m.recalled &&
        !m.pending &&
        !m.failed &&
        (m.mine || canAdminRecall)
    );
  const recallableSelected = selectedMessages.filter((m) => canRecallMsg(m));
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
    await copyTextToClipboard(text);
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

  /** Open DM with a group member and show their user detail panel. */
  async function openMemberChat(userId: string) {
    if (!userId || userId === chat.me?.id) return;
    try {
      await chat.openDM(userId);
      setMobileChatOpen(true);
      setShowDetails(true);
    } catch (e: any) {
      logChatError(e?.message || "Could not open chat");
    }
  }

  function openMemberMenu(
    e: ReactMouseEvent,
    member: {
      user_id: string;
      display_name: string;
      username: string;
      role: string;
      avatar_url?: string;
    }
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (member.user_id === chat.me?.id) return;
    if (member.role === "owner") return;
    const canPromote = isGroupOwner && (member.role === "member" || member.role === "admin");
    const canRemove =
      canEditGroup &&
      member.role !== "owner" &&
      !(myGroupRole === "admin" && member.role === "admin");
    if (!canPromote && !canRemove) return;
    const MENU_W = 200;
    const MENU_H = 140;
    const x = Math.min(Math.max(e.clientX, 8), window.innerWidth - MENU_W - 8);
    const y = Math.min(Math.max(e.clientY, 8), window.innerHeight - MENU_H - 8);
    setMemberMenu({ x, y, member });
  }

  async function setMemberAdminRole(userId: string, role: "admin" | "member") {
    if (!active) return;
    try {
      await api(`/v1/groups/${active.id}/admins`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, role }),
      });
      await reloadGroupDetails();
    } catch (e: any) {
      logChatError(e?.message || "Could not update role");
    }
  }

  async function removeGroupMember(userId: string) {
    if (!active) return;
    try {
      await api(`/v1/groups/${active.id}/members/${userId}`, { method: "DELETE" });
      await reloadGroupDetails();
    } catch (e: any) {
      logChatError(e?.message || "Could not remove member");
    }
  }

  async function leaveGroup() {
    if (!active) return;
    if (!window.confirm("Leave this group?")) return;
    try {
      await chat.leaveGroup(active.id);
      setShowDetails(false);
      setGroupDetails(null);
    } catch (e: any) {
      logChatError(e?.message || "Could not leave group");
    }
  }

  async function openAddMembers() {
    if (!active || !canEditGroup) return;
    setAddMembersBusy(true);
    try {
      const body = await api<any>("/v1/friends");
      const list = (Array.isArray(body?.friends) ? body.friends : Array.isArray(body) ? body : [])
        .filter((f: any) => String(f?.status ?? "accepted") === "accepted")
        .map((f: any) => ({
          user_id: String(f?.user_id ?? f?.friend_id ?? f?.id ?? ""),
          username: String(f?.username ?? ""),
          display_name: String(f?.display_name ?? f?.username ?? "Friend"),
          avatar_url: f?.avatar_url || undefined,
        }))
        .filter((f: { user_id: string }) => f.user_id);
      const memberIds = new Set((groupDetails?.members ?? []).map((m) => m.user_id));
      setAddMemberFriends(list.filter((f: { user_id: string }) => !memberIds.has(f.user_id)));
      setAddMemberLookup([]);
      setAddMemberQuery("");
      setAddMemberPicked(new Set());
      setAddMemberProfiles({});
      setAddMembersOpen(true);
    } catch (e: any) {
      logChatError(e?.message || "Could not load friends");
    } finally {
      setAddMembersBusy(false);
    }
  }

  async function confirmAddMembers() {
    if (!active || addMemberPicked.size === 0) {
      setAddMembersOpen(false);
      return;
    }
    setAddMembersBusy(true);
    try {
      await api(`/v1/groups/${active.id}/members`, {
        method: "POST",
        body: JSON.stringify({ member_ids: Array.from(addMemberPicked) }),
      });
      setAddMembersOpen(false);
      await reloadGroupDetails();
    } catch (e: any) {
      logChatError(e?.message || "Could not add members");
    } finally {
      setAddMembersBusy(false);
    }
  }

  useEffect(() => {
    if (!addMembersOpen) return;
    const q = addMemberQuery.trim();
    if (!q) {
      setAddMemberLookup([]);
      setAddMemberLookupBusy(false);
      return;
    }
    let cancelled = false;
    setAddMemberLookupBusy(true);
    const timer = window.setTimeout(() => {
      api<any>(`/v1/users/lookup?q=${encodeURIComponent(q)}`)
        .then((body) => {
          if (cancelled) return;
          const memberIds = new Set((groupDetails?.members ?? []).map((m) => m.user_id));
          setAddMemberLookup(
            (Array.isArray(body?.users) ? body.users : [])
              .map((u: any) => ({
                user_id: String(u?.id ?? ""),
                username: String(u?.username ?? ""),
                display_name: String(u?.display_name ?? u?.username ?? ""),
                avatar_url: u?.avatar_url || undefined,
              }))
              .filter((u: { user_id: string }) => u.user_id && !memberIds.has(u.user_id))
          );
        })
        .catch(() => {
          if (!cancelled) setAddMemberLookup([]);
        })
        .finally(() => {
          if (!cancelled) setAddMemberLookupBusy(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addMembersOpen, addMemberQuery, groupDetails?.members]);

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

 /** Timed speak-mute (JD 10m/1h/permanent); channel moderation has no timed per-member mute. */
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
        (canRecallMsg(msg) ? 1 : 0) + // recall (own or group admin)
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

  useEffect(() => {
    if (!memberMenu) return;
    const close = () => setMemberMenu(null);
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
  }, [memberMenu]);

  async function copyOne(msg: Message) {
    await copyTextToClipboard(msg.content);
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

 // channel info RHS: load group members when details open.
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

 // DM RHS: load peer profile (user profile popover / RHS).
  useEffect(() => {
    if (!showDetails || !active || active.type !== "dm" || !active.peerId) {
      setDmPeerProfile(null);
      return;
    }
    let cancelled = false;
    api<any>(`/v1/users/${active.peerId}`)
      .then((u) => {
        if (cancelled) return;
        setDmPeerProfile({
          id: String(u?.id ?? active.peerId),
          username: String(u?.username ?? ""),
          display_name: String(u?.display_name ?? u?.username ?? "User"),
          avatar_url: u?.avatar_url || undefined,
          real_name: u?.real_name != null ? String(u.real_name) : undefined,
          signature: u?.signature != null ? String(u.signature) : undefined,
          region: u?.region != null ? String(u.region) : undefined,
          online: Boolean(u?.online),
          last_active_at: u?.last_active_at ? String(u.last_active_at) : undefined,
        });
      })
      .catch(() => {
        if (!cancelled) setDmPeerProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showDetails, active?.id, active?.type, active?.peerId]);

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

 // global search (users + messages) when sidebar query is long enough.
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

  useEffect(() => {
    loadingOlderUIRef.current = false;
    setLoadingOlder(false);
    setEmojiOpen(false);
  }, [chat.activeId]);

  function insertComposerEmoji(emoji: string) {
    const el = draftRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = clipMessageText(draft.slice(0, start) + emoji + draft.slice(end));
    setDraft(next);
    if (chat.activeId && next.trim()) chat.notifyTyping(chat.activeId);
    requestAnimationFrame(() => {
      const node = draftRef.current;
      if (!node) return;
      node.focus();
      const pos = Math.min(start + emoji.length, next.length);
      node.setSelectionRange(pos, pos);
    });
  }

  function updateJumpBottomVisibility() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    nearBottomRef.current = near;
    setShowJumpBottom(!near && el.scrollHeight > el.clientHeight + 40);

    if (
      el.scrollTop < 80 &&
      chat.activeId &&
      chat.hasMoreByConv[chat.activeId] !== false &&
      !loadingOlderUIRef.current
    ) {
      loadingOlderUIRef.current = true;
      setLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      void chat.loadOlderMessages(chat.activeId).then((n) => {
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (node && n > 0) {
            node.scrollTop = node.scrollHeight - prevHeight + prevTop;
          }
          loadingOlderUIRef.current = false;
          setLoadingOlder(false);
        });
      });
    }

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

 // channel drafts: restore composer text when switching conversations.
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

 // focus_post_textbox / useTextboxFocus: focus composer so the user
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
    if (messageCharCount(text) > MESSAGE_MAX_CHARS) {
      logChatError(t("chat.messageTooLong"));
      return;
    }
    setEmojiOpen(false);
 // edit post: reuse the composer instead of a prompt dialog.
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
      return n === 1 ? t("chat.sendPhoto") : t("chat.sendPhotos", { n });
    }
    return n === 1 ? t("chat.sendFile") : t("chat.sendFiles", { n });
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

  function previewFor(msg: Message): { name: string; body: string } | undefined {
    if (!msg.replyToId) return undefined;
    const target = activeMessages.find((m) => m.id === msg.replyToId);
    if (!target) return { name: t("chat.reply"), body: t("chat.originalMessage") };
    const body = localizeChatLabel(
      target.content,
      t,
      { type: target.type }
    ) || t("chat.message");
    return {
      name: target.senderName ?? (target.mine ? t("chat.you") : t("chat.user")),
      body,
    };
  }

  return (
    <AppShell
      rail={false}
      mobilePane={mobilePane}
      sidebarCollapsed={!narrowLayout && sidebarCollapsed}
    >
      <ShellConnectionBanner
        reconnectOnly
        reconnecting={!chat.connected && wsEverConnected}
      />
      <aside className="sidebar">
        <div className="sidebar-header">
          <button
            type="button"
            className={`icon-btn ${mainMenuOpen ? "active" : ""}`}
            title={t("nav.menu")}
            onClick={(e) => {
              e.stopPropagation();
              setComposeOpen(false);
              setMainMenuOpen((v) => {
                const next = !v;
                if (next) void chat.refreshMe();
                return next;
              });
            }}
          >
            <MenuIcon d={ICONS.menu} />
          </button>
          <div className="search-wrap">
            <MenuIcon
              d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M21 21l-4.3-4.3"
              style={{ width: 16, height: 16 }}
            />
            <input
              className="search-input"
              placeholder={
                chat.connected || !wsEverConnected
                  ? t("common.search")
                  : t("common.reconnecting")
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!chat.connected && wsEverConnected && (
              <span className="spinner" aria-label={t("common.reconnecting")} />
            )}
          </div>
          {mainMenuOpen && (
            <div className="popup-menu main-menu" onClick={(e) => e.stopPropagation()}>
              <div className="main-menu-header">
                <div className="main-menu-profile">
                  <Avatar
                    name={chat.me?.nickname || chat.me?.username || "?"}
                    url={chat.me?.avatarUrl}
                    size={72}
                  />
                  <span className="main-menu-profile-name">
                    {chat.me?.nickname || chat.me?.username || t("nav.profile")}
                  </span>
                  <span className="main-menu-profile-meta">
                    {[
                      chat.me?.username ? `@${chat.me.username}` : null,
                      chat.me?.phone || null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
                <div className="ctx-sep main-menu-profile-sep" />
                {chat.me?.id && (
                  <div className="main-menu-profile-id">
                    <span className="main-menu-profile-id-label">ID</span>
                    <span className="main-menu-profile-id-text">{chat.me.id}</span>
                    <button
                      type="button"
                      className="main-menu-copy-btn"
                      title={idCopied ? t("me.idCopied") : t("me.copyId")}
                      aria-label={t("me.copyId")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const id = chat.me?.id;
                        if (!id) return;
                        void copyTextToClipboard(id).then((ok) => {
                          if (!ok) return;
                          setIdCopied(true);
                          setTimeout(() => setIdCopied(false), 1500);
                        });
                      }}
                    >
                      <MenuIcon
                        d={idCopied ? ICONS.select : ICONS.copy}
                        style={{ width: 18, height: 18 }}
                      />
                    </button>
                  </div>
                )}
              </div>
              <div className="ctx-sep" />
              <Link className="ctx-item" href="/profile">
                <MenuIcon d={ICONS.idCard} />
                {t("nav.profile")}
              </Link>
              <Link className="ctx-item" href="/friends">
                <MenuIcon d={ICONS.user} />
                {t("menu.contacts")}
              </Link>
              <Link className="ctx-item" href="/groups">
                <MenuIcon d={ICONS.users} />
                {t("menu.groups")}
              </Link>
              <Link className="ctx-item" href="/settings">
                <MenuIcon d={ICONS.settings} />
                {t("menu.settings")}
              </Link>
              <button
                className="ctx-item"
                onClick={() => {
                  const order = ["dark", "light", "system"] as const;
                  const i = order.indexOf(theme);
                  setTheme(order[(i + 1) % order.length]);
                }}
              >
                <MenuIcon d={theme === "light" ? ICONS.themeSun : ICONS.theme} />
                {t("menu.theme")}: {labelTheme(theme)}
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  const order = ["en", "zh", "system"] as const;
                  const i = order.indexOf(locale);
                  setLocale(order[(i + 1) % order.length]);
                }}
              >
                <MenuIcon d={ICONS.language} />
                {t("menu.language")}: {labelLocale(locale)}
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  const order = ["online", "away", "dnd", "offline"] as const;
                  const i = order.indexOf(myStatus);
                  const next = order[(i + 1) % order.length];
                  noteManualStatusChange(next);
                  setMyStatus(next);
                  api("/v1/me/status", {
                    method: "PUT",
                    body: JSON.stringify({ status: next }),
                  }).catch(() => { });
                }}
              >
                <MenuIcon d={ICONS.status} />
                {t("status.label")}:{" "}
                {myStatus === "online"
                  ? t("status.online")
                  : myStatus === "away"
                    ? t("status.away")
                    : myStatus === "dnd"
                      ? t("status.dnd")
                      : t("status.offline")}
              </button>
              <div className="ctx-sep" />
              <button className="ctx-item" onClick={logout}>
                <MenuIcon d={ICONS.logout} />
                {t("nav.logOut")}
              </button>
            </div>
          )}
        </div>
        <div className="conv-list">
          {globalSearch.active ? (
            <div className="search-results">
              {globalSearch.loading && <div className="muted" style={{ padding: 12 }}>{t("chat.searching")}</div>}
              {globalSearch.users.length > 0 && (
                <div className="search-section">
                  <div className="search-section-title">{t("chat.people")}</div>
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
                  <div className="search-section-title">{t("chat.messages")}</div>
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
                  <div className="muted" style={{ padding: 14 }}>{t("chat.noResults")}</div>
                )}
            </div>
          ) : (
            <>
              {chat.loadError && (
                <div style={{ padding: 14 }}>
                  <button className="btn-ghost" onClick={chat.reload}>
                    {t("chat.retry")}
                  </button>
                </div>
              )}
              {!chat.loadError && filtered.length === 0 && (
                <div style={{ padding: 20 }} className="muted">
                  {t("chat.noConversationsYet")}
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
                    c.type === "dm" && c.peerId
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
                  onMarkUnread={() => {
                    chat.markUnread(c.id).catch(() => { });
                  }}
                  onBlock={
                    c.type === "dm" && (c.friendshipId || c.peerId)
                      ? () =>
                          setConfirmRequest({
                            title: t("ctx.blockUser"),
                            message: t("ctx.blockUserConfirm"),
                            confirmLabel: t("common.block"),
                            danger: true,
                            onConfirm: () => {
                              chat.blockUser(c.friendshipId || c.peerId!).catch(() => { });
                            },
                          })
                      : undefined
                  }
                  onClearHistory={() =>
                    setConfirmRequest({
                      title: t("ctx.clearHistory"),
                      message: t("ctx.clearHistoryConfirm"),
                      confirmLabel: t("common.clear"),
                      danger: true,
                      onConfirm: () => {
                        chat.clearHistory(c.id).catch(() => { });
                      },
                    })
                  }
                  onDelete={() => {
                    const isGroup = c.type === "social_group" || c.type === "group";
                    setConfirmRequest({
                      title: isGroup ? t("ctx.leaveChat") : t("ctx.deleteChat"),
                      message: isGroup ? t("ctx.leaveChatConfirm") : t("ctx.deleteChatConfirm"),
                      confirmLabel: isGroup ? t("common.leave") : t("common.delete"),
                      danger: true,
                      onConfirm: () => {
                        const run =
                          isGroup && c.type === "social_group"
                            ? chat.leaveGroup(c.id)
                            : chat.deleteConversation(c.id);
                        run.catch(() => { });
                      },
                    });
                  }}
                  onOpenNewWindow={() => {
                    const url = `${window.location.origin}/?c=${encodeURIComponent(c.id)}`;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
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
              {t("menu.joinCompany")}
            </button>
            <Link className="ctx-item" href="/groups">
              <MenuIcon d={ICONS.users} />
              {t("menu.newGroup")}
            </Link>
            <Link className="ctx-item" href="/friends">
              <MenuIcon d={ICONS.user} />
              {t("menu.newPrivateChat")}
            </Link>
          </div>
        )}
      </aside>

      <main className="chat-pane">
        {!active ? null : (
          <>
            {pinsListOpen ? (
              <div className="chat-header">
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title={t("chat.backToChat")}
                  aria-label={t("chat.backToChat")}
                  onClick={() => setPinsListOpen(false)}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{t("chat.pinnedMessages")}</div>
                  <div className="sub">
                    {pinnedList.length === 1
                      ? t("chat.pinCountOne")
                      : t("chat.pinCount", { n: pinnedList.length })}
                  </div>
                </div>
              </div>
            ) : selectMode ? (
              <div className="chat-header select-bar">
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title={t("chat.backToChats")}
                  onClick={backToConversationList}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
                <button
                  className="btn-ghost"
                  style={{ borderRadius: 8, padding: "6px 10px" }}
                  onClick={clearSelection}
                  title={t("chat.cancelSelection")}
                >
                  {"\u2715"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">
                    {t("chat.selectedCount", { n: selectedIds.size })}
                  </div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ borderRadius: 8, padding: "6px 10px" }}
                  onClick={copySelected}
                >
                  {t("chat.copy")}
                </button>
                {forwardableSelected.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ borderRadius: 8, padding: "6px 10px" }}
                    onClick={() => setForwardIds(forwardableSelected.map((m) => m.id))}
                  >
                    {t("chat.forward")}
                  </button>
                )}
                {recallableSelected.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ borderRadius: 8, padding: "6px 10px", color: "var(--danger)" }}
                    onClick={recallSelected}
                  >
                    {t("chat.recall")}
                  </button>
                )}
              </div>
            ) : showInChatSearch ? (
              <div className="chat-header" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="icon-btn chat-back-btn"
                  title={t("chat.backToChats")}
                  onClick={backToConversationList}
                >
                  <MenuIcon d={ICONS.back} />
                </button>
                <div className="search-wrap">
                  <MenuIcon
                    d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M21 21l-4.3-4.3"
                    style={{ width: 16, height: 16 }}
                  />
                  <input
                    className="search-input"
                    autoFocus
                    placeholder={t("chat.searchInConversation")}
                    value={inChatSearch}
                    onChange={(e) => setInChatSearch(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("chat.closeSearch")}
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
                  title={
                    narrowLayout
                      ? t("chat.backToChats")
                      : sidebarCollapsed
                        ? t("chat.showSidebar")
                        : t("chat.hideSidebar")
                  }
                  aria-label={
                    narrowLayout
                      ? t("chat.backToChats")
                      : sidebarCollapsed
                        ? t("chat.showSidebar")
                        : t("chat.hideSidebar")
                  }
                  aria-expanded={narrowLayout ? undefined : !sidebarCollapsed}
                  onClick={toggleSidebarMenu}
                >
                  <MenuIcon
                    d={
                      !narrowLayout && sidebarCollapsed
                        ? ICONS.forwardChevron
                        : ICONS.back
                    }
                  />
                </button>
                <div
                  className="chat-header clickable"
                  style={{ flex: 1, border: "none", padding: 0, minWidth: 0 }}
                  title={t("chat.viewDetails")}
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
                      {formatTypingLabel(chat.typingByConv[active.id] ?? [], t) ||
                        (active.type === "dm"
                          ? (() => {
                            const p = active.peerId
                              ? chat.presenceByUser[active.peerId]
                              : undefined;
                            const online = p?.online ?? active.peerOnline;
                            if (online) return t("presence.online");
                            return formatLastSeen(p?.lastActiveAt || active.peerLastActiveAt, t);
                          })()
                          : `${active.type.replace("_", " ")}${isGroup ? ` · ${chat.myRole}` : ""}`)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("chat.searchInChat")}
                  onClick={() => setShowInChatSearch(true)}
                >
                  <MenuIcon d={"M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M21 21l-4.3-4.3"} />
                </button>
                {active.type === "dm" && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("chat.voiceCallTitle")}
                      disabled={!!call.active || !!call.incoming}
                      onClick={() => {
                        call
                          .startCall(
                            active.id,
                            "voice",
                            conversationDisplayName(active),
                            active.avatarUrl
                          )
                          .catch((e) => logChatError(e.message));
                      }}
                    >
                      <MenuIcon d={ICONS.phone} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("chat.videoCallTitle")}
                      disabled={!!call.active || !!call.incoming}
                      onClick={() => {
                        call
                          .startCall(
                            active.id,
                            "video",
                            conversationDisplayName(active),
                            active.avatarUrl
                          )
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
                {chatSearch.loading && <div className="muted">{t("chat.searching")}</div>}
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
                  <div className="muted">{t("chat.noMatchesInChat")}</div>
                )}
              </div>
            )}

            {pinnedList.length > 0 && !pinsListOpen && (
              <div className="pinned-banner">
                <div className="pinned-accent" aria-hidden />
                <button
                  type="button"
                  className="pinned-banner-main"
                  title={t("chat.jumpNextPinned")}
                  onClick={jumpPinnedBar}
                >
                  <div className="pinned-label">
                    {t("chat.pinnedBannerLabel")}
                    {pinnedList.length > 1 ? ` · ${pinnedList.length}` : ""}
                  </div>
                  <div className="pinned-text">
                    {(barPin ?? pinnedList[pinnedList.length - 1])?.body ||
                      t("chat.pinnedMessage")}
                  </div>
                </button>
                <button
                  type="button"
                  className="pinned-list-btn"
                  title={t("chat.pinnedMessages")}
                  aria-label={t("chat.pinnedMessages")}
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
                    <div className="chat-drop-title">{t("chat.dropFilesHere")}</div>
                    <div className="chat-drop-sub">{t("chat.dropFilesSub")}</div>
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
                          <div className="muted">{t("chat.noPinnedMessages")}</div>
                        </div>
                      )}
                      {pinnedThreadMessages.map((m) => (
                        <div key={m.id} className="pins-thread-item">
                          <Bubble
                            msg={m}
                            isGroup={!!isGroup}
                            peerName={active?.title}
                            peerAvatar={active?.avatarUrl}
                            myName={chat.me?.nickname || chat.me?.username || "You"}
                            myAvatar={chat.me?.avatarUrl}
                            replyPreview={previewFor(m)}
                            selectMode={selectMode}
                            selected={selectedIds.has(m.id)}
                            selectable={!m.pending && !m.failed}
                            pinned
                            onToggleSelect={() => toggleSelect(m.id)}
                            onContextMenu={(e) => openCtxMenu(e, m)}
                            ctxOpen={!!ctxMenu && ctxMenu.msgId === m.id}
                            onReplyPreviewClick={(replyToId) => jumpToPinnedId(replyToId)}
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
                          <div className="muted">{t("chat.noMessagesHere")}</div>
                        </div>
                      )}
                      {(loadingOlder ||
                        (chat.activeId && chat.hasMoreByConv[chat.activeId] === false && activeMessages.length > 0)) && (
                        <div className="muted" style={{ textAlign: "center", padding: "8px 0", fontSize: 12 }}>
                          {loadingOlder
                            ? t("chat.loadingOlder")
                            : t("chat.historyStart")}
                        </div>
                      )}
                      {activeMessages.map((m) => (
                        <div key={m.id} id={`msg-${m.id}`}>
                          <Bubble
                            msg={m}
                            isGroup={!!isGroup}
                            peerName={active?.title}
                            peerAvatar={active?.avatarUrl}
                            myName={chat.me?.nickname || chat.me?.username || "You"}
                            myAvatar={chat.me?.avatarUrl}
                            replyPreview={previewFor(m)}
                            selectMode={selectMode}
                            selected={selectedIds.has(m.id)}
                            selectable={!m.pending && !m.failed}
                            pinned={pinnedIdSet.has(m.id)}
                            onToggleSelect={() => toggleSelect(m.id)}
                            onContextMenu={(e) => openCtxMenu(e, m)}
                            ctxOpen={!!ctxMenu}
                            onReplyPreviewClick={(replyToId) => jumpToPinnedId(replyToId)}
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
                    title={t("chat.scrollToBottom")}
                    aria-label={t("chat.scrollToBottom")}
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
                        <div className="reply-name">{t("chat.editMessage")}</div>
                        <div className="reply-text">{editingMessage.content}</div>
                      </div>
                      <button
                        type="button"
                        className="reply-close"
                        title={t("chat.cancelEdit")}
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
                        title={t("chat.cancelReply")}
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
                          title={t("chat.cancelRecording")}
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
                          title={t("chat.sendVoiceMessage")}
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
                          title={t("chat.attachFile")}
                          disabled={voiceBusy || !chat.activeId}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <MenuIcon d={ICONS.paperclip} style={{ width: 20, height: 20 }} />
                        </button>
                        <button
                          type="button"
                          className={`attach-btn${emojiOpen ? " active" : ""}`}
                          title={t("chat.emoji")}
                          disabled={voiceBusy || !chat.activeId}
                          aria-expanded={emojiOpen}
                          onClick={() => setEmojiOpen((v) => !v)}
                        >
                          <MenuIcon d={ICONS.smile} style={{ width: 20, height: 20 }} />
                        </button>
                        {emojiOpen && (
                          <div className="emoji-picker" role="dialog" aria-label={t("chat.emoji")}>
                            <div className="emoji-picker-grid">
                              {COMPOSER_EMOJIS.map((em) => (
                                <button
                                  key={em}
                                  type="button"
                                  className="emoji-picker-cell"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    insertComposerEmoji(em);
                                  }}
                                >
                                  {em}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <textarea
                          ref={draftRef}
                          rows={1}
                          placeholder={
                            isGroup
                              ? t("chat.messagePlaceholderGroup")
                              : t("chat.messagePlaceholder")
                          }
                          value={draft}
                          disabled={voiceBusy}
                          onChange={(e) => {
                            const value = clipMessageText(e.target.value);
                            const cursor = Math.min(
                              e.target.selectionStart ?? value.length,
                              value.length
                            );
                            setDraft(value);
                            setEmojiOpen(false);
                            updateMentionMenu(value, cursor);
                            if (!chat.activeId) return;
                            if (value.trim()) chat.notifyTyping(chat.activeId);
                            else chat.stopTyping(chat.activeId);
                          }}
                          onClick={(e) => {
                            const t = e.currentTarget;
                            setEmojiOpen(false);
                            updateMentionMenu(t.value, t.selectionStart ?? t.value.length);
                          }}
                          onPaste={onComposerPaste}
                          onKeyDown={(e) => {
                            if (e.key === "Escape" && emojiOpen) {
                              e.preventDefault();
                              setEmojiOpen(false);
                              return;
                            }
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
                        {draftChars > 0 && (
                          <span
                            className={`composer-char-count${
                              draftChars >= MESSAGE_MAX_CHARS - 50 ? " warn" : ""
                            }`}
                            aria-live="polite"
                          >
                            {t("chat.charCount", {
                              n: draftChars,
                              max: MESSAGE_MAX_CHARS,
                            })}
                          </span>
                        )}
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
                          <button className="send-btn danger" onClick={cancelEdit} title={t("chat.cancelEdit")}>
                            {"\u2715"}
                          </button>
                        ) : (
                          <button
                            className="send-btn"
                            title={t("chat.recordVoiceMessage")}
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
            title={t("chat.close")}
            onClick={() => setShowDetails(false)}
          >
            {"\u2715"}
          </button>
          <Avatar
            name={conversationDisplayName(active)}
            url={
              active.type === "dm"
                ? dmPeerProfile?.avatar_url || active.avatarUrl
                : groupDetails?.avatar_url || active.avatarUrl
            }
            size={96}
          />
          {canEditGroup && (
            <>
              <input
                ref={groupAvatarInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
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
          {active.type === "dm" && dmPeerProfile && (
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              @{dmPeerProfile.username}
              {dmPeerProfile.online
                ? ` · ${t("presence.online")}`
                : dmPeerProfile.last_active_at
                  ? ` · ${formatLastSeen(dmPeerProfile.last_active_at, t)}`
                  : ""}
            </div>
          )}
          {active.type === "dm" && dmPeerProfile?.signature ? (
            <div style={{ marginTop: 10, fontSize: 13, textAlign: "center", maxWidth: 260 }}>
              {dmPeerProfile.signature}
            </div>
          ) : null}
          {active.type === "dm" && dmPeerProfile?.region ? (
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              {dmPeerProfile.region}
            </div>
          ) : null}
          {active.type === "dm" && dmPeerProfile?.real_name ? (
            <div className="kv" style={{ marginTop: 10 }}>
              <div className="k">{t("details.realName")}</div>
              <div>{dmPeerProfile.real_name}</div>
            </div>
          ) : null}
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
            <div className="k">{t("details.type")}</div>
            <div>{active.type}</div>
          </div>
          <div className="kv">
            <div className="k">{t("details.conversationId")}</div>
            <div style={{ wordBreak: "break-all" }}>{active.id}</div>
          </div>
          <div className="kv">
            <div className="k">{t("details.lastActivity")}</div>
            <div>{active.lastMessageAt ? fmtTime(active.lastMessageAt) : "\u2014"}</div>
          </div>
          {isGroup && groupDetails && (
            <>
              {groupDetails.public_id && (
                <div className="kv">
                  <div className="k">{t("details.inviteId")}</div>
                  <div>{groupDetails.public_id}</div>
                </div>
              )}
              {groupDetails.public_id && (
                <div className="group-qr-block">
                  <div className="k" style={{ marginBottom: 8 }}>
                    {t("details.inviteQr")}
                  </div>
                  <GroupQr publicId={groupDetails.public_id} size={140} />
                </div>
              )}
              {canEditGroup ? (
                <div className="group-meta-edit">
                  <label className="k">{t("details.groupName")}</label>
                  <input
                    value={groupEditTitle}
                    onChange={(e) => setGroupEditTitle(e.target.value)}
                    maxLength={80}
                  />
                  <label className="k">{t("details.description")}</label>
                  <textarea
                    value={groupEditDesc}
                    onChange={(e) => setGroupEditDesc(e.target.value)}
                    rows={2}
                    maxLength={500}
                  />
                  <label className="k">{t("details.announcement")}</label>
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
                    {groupMetaBusy ? t("common.saving") : t("details.saveGroupInfo")}
                  </button>
                  <label className="group-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(groupDetails.forbid_member_friend_add)}
                      disabled={groupMetaBusy}
                      onChange={() => toggleForbidFriendAdd().catch(() => { })}
                    />
                    <span className="group-toggle-label">
                      {t("details.forbidFriendAdd")}
                    </span>
                  </label>
                </div>
              ) : (
                <>
                  {groupDetails.announcement && (
                    <div className="kv">
                      <div className="k">{t("details.announcement")}</div>
                      <div>{groupDetails.announcement}</div>
                    </div>
                  )}
                  {groupDetails.description && (
                    <div className="kv">
                      <div className="k">{t("details.description")}</div>
                      <div>{groupDetails.description}</div>
                    </div>
                  )}
                  {groupDetails.forbid_member_friend_add && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t("details.membersCannotAdd")}
                    </div>
                  )}
                </>
              )}
              <div className="kv">
                <div className="k">{t("details.yourRole")}</div>
                <div>{groupDetails.role || chat.myRole}</div>
              </div>
              {groupDetails.mute_all && (
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                  {t("details.groupMutedAll")}
                </div>
              )}
              <div className="details-members">
                <div
                  className="k"
                  style={{
                    marginBottom: 8,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>
                    {t("details.membersCount", { n: groupDetails.members.length })}
                  </span>
                  {canEditGroup && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "2px 8px" }}
                      disabled={addMembersBusy}
                      onClick={() => openAddMembers().catch(() => {})}
                    >
                      {t("details.addMembers")}
                    </button>
                  )}
                </div>
                {addMembersOpen && (
                  <div className="card" style={{ marginBottom: 12, padding: 10, display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{t("details.addFriendsToGroup")}</div>
                    <input
                      type="search"
                      placeholder={t("details.searchUsersPlaceholder")}
                      value={addMemberQuery}
                      onChange={(e) => setAddMemberQuery(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {(() => {
                      const q = addMemberQuery.trim().toLocaleLowerCase();
                      const friendIds = new Set(addMemberFriends.map((f) => f.user_id));
                      const selectedRows = Array.from(addMemberPicked)
                        .map((id) => addMemberProfiles[id])
                        .filter(Boolean) as {
                        user_id: string;
                        username: string;
                        display_name: string;
                        avatar_url?: string;
                        isFriend: boolean;
                      }[];
                      const friendRows = addMemberFriends.filter((f) => {
                        if (addMemberPicked.has(f.user_id)) return false;
                        if (!q) return true;
                        const hay = `${f.display_name} ${f.username} ${f.user_id}`.toLocaleLowerCase();
                        return hay.includes(q);
                      });
                      const extra = addMemberLookup.filter(
                        (u) => !friendIds.has(u.user_id) && !addMemberPicked.has(u.user_id)
                      );
                      const rows = [
                        ...selectedRows,
                        ...friendRows.map((f) => ({ ...f, isFriend: true })),
                        ...extra.map((u) => ({ ...u, isFriend: false })),
                      ];
                      if (rows.length === 0 && !addMemberLookupBusy) {
                        return <div className="muted">{t("details.noFriendsLeft")}</div>;
                      }
                      return (
                        <>
                          {rows.map((f) => {
                            const on = addMemberPicked.has(f.user_id);
                            return (
                              <label key={f.user_id} className="check-row" style={{ gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => {
                                    setAddMemberPicked((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(f.user_id)) next.delete(f.user_id);
                                      else next.add(f.user_id);
                                      return next;
                                    });
                                    setAddMemberProfiles((prev) => {
                                      if (prev[f.user_id]) {
                                        const next = { ...prev };
                                        delete next[f.user_id];
                                        return next;
                                      }
                                      return {
                                        ...prev,
                                        [f.user_id]: {
                                          user_id: f.user_id,
                                          username: f.username,
                                          display_name: f.display_name,
                                          avatar_url: f.avatar_url,
                                          isFriend: f.isFriend,
                                        },
                                      };
                                    });
                                  }}
                                />
                                <Avatar name={f.display_name} url={f.avatar_url} size={24} />
                                <span>
                                  {f.display_name}{" "}
                                  <span className="muted">
                                    @{f.username}
                                    {!f.isFriend ? ` · ${t("groups.notAFriend")}` : ""}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                          {addMemberLookupBusy && (
                            <div className="muted">{t("details.searchingUsers")}</div>
                          )}
                        </>
                      );
                    })()}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={addMembersBusy || addMemberPicked.size === 0}
                        onClick={() => confirmAddMembers().catch(() => {})}
                      >
                        {addMembersBusy
                          ? t("details.adding")
                          : t("details.addCount", { n: addMemberPicked.size })}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setAddMembersOpen(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                )}
                {groupDetails.members.map((m) => {
                  const mutedUntil = m.mute_until ? new Date(m.mute_until) : null;
                  const isMuted =
                    mutedUntil != null && !Number.isNaN(mutedUntil.getTime()) && mutedUntil.getTime() > Date.now();
                  const permanentMute =
                    mutedUntil != null && mutedUntil.getUTCFullYear() >= 9999;
                  const isMe = m.user_id === chat.me?.id;
                  return (
                    <div
                      key={m.user_id}
                      className={`details-member details-member-admin${isMe ? " is-me" : " is-clickable"}`}
                      role={isMe ? undefined : "button"}
                      tabIndex={isMe ? undefined : 0}
                      onClick={() => {
                        if (!isMe) openMemberChat(m.user_id).catch(() => {});
                      }}
                      onKeyDown={(e) => {
                        if (isMe) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openMemberChat(m.user_id).catch(() => {});
                        }
                      }}
                      onContextMenu={(e) => openMemberMenu(e, m)}
                    >
                      <Avatar name={m.display_name} url={m.avatar_url} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {m.display_name}
                          {isMe ? <span className="member-me-badge">{t("details.me")}</span> : null}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          @{m.username} · {m.role}
                          {isMuted
                            ? permanentMute
                              ? ` · ${t("details.mutedPermanently")}`
                              : ` · ${t("details.mutedUntil", { time: mutedUntil!.toLocaleString() })}`
                            : ""}
                        </div>
                        {canEditGroup && m.role !== "owner" && !isMe && (
                          <div
                            className="mute-actions"
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()}
                          >
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
                              {t("details.mute")}
                            </button>
                            {isMuted && (
                              <button
                                type="button"
                                className="btn-ghost mute-chip"
                                onClick={() => muteMember(m.user_id, "off").catch(() => { })}
                              >
                                {t("details.unmute")}
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
                      {t("details.unmuteGroup")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => muteMember("", "all").catch(() => { })}
                    >
                      {t("details.muteGroup")}
                    </button>
                  )}
                </div>
              )}
              <Link className="btn-ghost" href="/groups" style={{ marginTop: 12, textAlign: "center" }}>
                {t("details.moreGroupSettings")}
              </Link>
              {!isGroupOwner && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ marginTop: 8, color: "var(--danger, #dc2626)" }}
                  onClick={() => leaveGroup()}
                >
                  {t("details.leaveGroup")}
                </button>
              )}
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
              {active.muted
                ? t("details.unmuteConversation")
                : t("details.muteConversation")}
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
            {t("ctx.copySelected")}
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
              {t("ctx.forwardSelected")}
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
            {t("ctx.clearSelection")}
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
                {t("ctx.recallSelected")}
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
            {t("chat.select")}
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
                {t("chat.reply")}
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
              {t("ctx.copy")}
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
                {t("chat.forward")}
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
              {t("chat.select")}
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
                {t("chat.retry")}
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
                    {t("ctx.edit")}
                  </button>
                )}
                {canPin && (
                  <button
                    className="ctx-item"
                    onClick={() => {
                      const pinned = pinnedIdSet.has(ctxMsg.id);
                      chat.pinMessage(ctxMsg.id, chat.activeId!, !pinned).catch(() => { });
                      setCtxMenu(null);
                    }}
                  >
                    <MenuIcon d={ICONS.pin} />
                    {pinnedIdSet.has(ctxMsg.id) ? t("ctx.unpin") : t("ctx.pin")}
                  </button>
                )}
              </>
            )}
            {canRecallMsg(ctxMsg) && chat.activeId && (
              <button
                className="ctx-item danger"
                onClick={() => {
                  chat.recallMessage(ctxMsg.id, chat.activeId!);
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.trash} />
                {t("chat.recall")}
              </button>
            )}
            {!ctxMsg.mine && !ctxMsg.recalled && canPin && chat.activeId && (
              <button
                className="ctx-item"
                onClick={() => {
                  const pinned = pinnedIdSet.has(ctxMsg.id);
                  chat.pinMessage(ctxMsg.id, chat.activeId!, !pinned).catch(() => { });
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.pin} />
                {pinnedIdSet.has(ctxMsg.id) ? t("ctx.unpin") : t("ctx.pin")}
              </button>
            )}
          </div>
        </div>
      )}

      {memberMenu && (
        <div
          className="ctx-menu"
          style={{ left: memberMenu.x, top: memberMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {isGroupOwner && memberMenu.member.role === "member" && (
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                const id = memberMenu.member.user_id;
                setMemberMenu(null);
                setMemberAdminRole(id, "admin").catch(() => {});
              }}
            >
              {t("ctx.promoteAdmin")}
            </button>
          )}
          {isGroupOwner && memberMenu.member.role === "admin" && (
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                const id = memberMenu.member.user_id;
                setMemberMenu(null);
                setMemberAdminRole(id, "member").catch(() => {});
              }}
            >
              {t("ctx.removeAdmin")}
            </button>
          )}
          {canEditGroup &&
            memberMenu.member.role !== "owner" &&
            !(myGroupRole === "admin" && memberMenu.member.role === "admin") && (
              <button
                type="button"
                className="ctx-item danger"
                onClick={() => {
                  const id = memberMenu.member.user_id;
                  const name = memberMenu.member.display_name;
                  setMemberMenu(null);
                  if (window.confirm(t("ctx.removeFromGroupConfirm", { name }))) {
                    removeGroupMember(id).catch(() => {});
                  }
                }}
              >
                {t("ctx.removeFromGroup")}
              </button>
            )}
        </div>
      )}

      {joinCompanyOpen && (
        <div
          className="forward-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t("menu.joinCompany")}
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
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{t("menu.joinCompany")}</h3>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              {t("join.hint")}
            </p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="join-invite">{t("join.inviteCode")}</label>
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
                {t("common.cancel")}
              </button>
              <button className="btn" type="submit" disabled={joinBusy || !joinInvite.trim()}>
                {joinBusy ? t("join.joining") : t("join.submit")}
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
                title={t("common.cancel")}
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
                      title={t("common.remove")}
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
                      title={t("common.remove")}
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
                  mediaDraft.mode === "photos"
                    ? t("chat.addCaption")
                    : t("chat.addMessage")
                }
                value={mediaDraft.caption}
                disabled={mediaSending}
                onPaste={onMediaDraftPaste}
                onChange={(e) =>
                  setMediaDraft((prev) =>
                    prev ? { ...prev, caption: clipMessageText(e.target.value) } : prev
                  )
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
              {messageCharCount(mediaDraft.caption) > 0 && (
                <span
                  className={`composer-char-count${
                    messageCharCount(mediaDraft.caption) >= MESSAGE_MAX_CHARS - 50
                      ? " warn"
                      : ""
                  }`}
                >
                  {t("chat.charCount", {
                    n: messageCharCount(mediaDraft.caption),
                    max: MESSAGE_MAX_CHARS,
                  })}
                </span>
              )}
              <button
                type="button"
                className="send-btn"
                title={t("chat.send")}
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
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </AppShell>
  );
}

/** ForwardPostModal-style picker; Qchat API already accepts multiple conversation_ids. */
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
  const { t } = useLocale();
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
    <div className="forward-modal" role="dialog" aria-label={t("chat.forwardMessages")}>
      <div className="forward-modal-card">
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
          {messageCount > 1
            ? t("chat.forwardTitleMany", { n: messageCount })
            : t("chat.forwardTitleOne")}
        </h3>
        <input
          placeholder={t("chat.searchConversations")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div className="forward-modal-list">
          {filtered.length === 0 && <div className="muted">{t("chat.noConversations")}</div>}
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
                  {c.type === "dm" ? t("chat.directMessage") : t("chat.group")}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="forward-modal-actions">
          <button className="btn-ghost" type="button" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => submit().catch(() => { })}
          >
            {busy
              ? t("chat.sending")
              : selected.size > 0
                ? t("chat.sendToCount", { n: selected.size })
                : t("chat.selectTargets")}
          </button>
        </div>
      </div>
    </div>
  );
}
