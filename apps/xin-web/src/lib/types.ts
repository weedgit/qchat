import type { MessageKey, ResolvedLocale } from "@qchat/i18n";
import { formatShortDate } from "./datetime";
import { newUUID } from "./uuid";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface CurrentUser {
  id: string;
  phone: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
  /** Non-empty when the user belongs to an enterprise. */
  enterpriseId?: string;
  /** Enterprise display name when enterpriseId is set. */
  enterpriseName?: string;
}

export interface Conversation {
  id: string;
  type: "dm" | "social_group" | "group" | string;
  title: string;
  avatarUrl?: string;
  /** Membership role for the current user (groups). */
  role?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastMessageSender?: string;
  lastMessageMine?: boolean;
  unreadCount: number;
  mentionCount?: number;
  peerId?: string;
  peerOnline?: boolean;
  peerLastActiveAt?: string;
  favorite?: boolean;
  muted?: boolean;
  pinnedMessageId?: string;
  pinnedMessage?: string;
  /** Company-wide default internal chat. */
  isEnterpriseDefault?: boolean;
  /** Owning enterprise display name when this conversation belongs to a company. */
  enterpriseName?: string;
  /** All pins for this conversation, ordered by seq ascending (top→bottom). */
  pinnedMessages?: { id: string; body: string; type?: string; seq?: number }[];
  /** Viewer-only friend alias (note). */
  friendNote?: string;
  friendshipId?: string;
  friendTags?: string[];
}

export interface Reactor {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  users: Reactor[];
}

export interface ReceiptUser {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string;
  content: string;
  type?: string;
  mediaUrl?: string;
  createdAt: string;
  mine?: boolean;
  pending?: boolean;
  /** 0–1 while a media upload is in flight. */
  uploadProgress?: number;
  failed?: boolean;
  /** Human-readable send/upload failure shown on the bubble. */
  error?: string;
  /** Local File kept for Retry after a failed media upload. */
  localFile?: File;
  clientMsgId?: string;
  seq?: number;
  recalled?: boolean;
  replyToId?: string;
  delivered?: boolean;
  read?: boolean;
  readBy?: ReceiptUser[];
  unreadBy?: ReceiptUser[];
  readCount?: number;
  memberCount?: number;
  reactions?: Reaction[];
  editedAt?: string;
  mentions?: string[];
  mentionAll?: boolean;
}

export interface Friend {
  /** peer user id */
  userId: string;
  friendshipId: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
  online?: boolean;
  status: "pending" | "accepted" | "rejected" | "blocked" | string;
  incoming?: boolean;
  outgoing?: boolean;
  note?: string;
  tags?: string[];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

export function normalizeConversation(raw: any): Conversation {
  const last = raw?.last_message ?? raw?.lastMessage;
  const typ = str(raw?.type, "dm");
  const title = str(
    raw?.title || raw?.peer_name || raw?.peer_nickname || raw?.name,
    typ === "dm" ? "Direct message" : "Conversation"
  );
  return {
    id: str(raw?.id ?? raw?.conversation_id),
    type: typ,
    title,
    avatarUrl: str(raw?.avatar_url ?? raw?.avatarUrl) || undefined,
    role: str(raw?.role) || undefined,
    lastMessage:
      typeof last === "string" ? last : str(last?.content ?? last?.body ?? last?.text) || undefined,
    lastMessageAt: str(raw?.last_message_at ?? raw?.updated_at ?? last?.created_at) || undefined,
    lastMessageSender: str(raw?.last_message_sender) || undefined,
    lastMessageMine: Boolean(raw?.last_message_mine),
    unreadCount: Number(raw?.unread_count ?? raw?.unread ?? 0) || 0,
    mentionCount: Number(raw?.mention_count ?? 0) || 0,
    peerId: str(raw?.peer_id) || undefined,
    peerOnline: raw?.peer_online != null ? Boolean(raw.peer_online) : undefined,
    peerLastActiveAt: str(raw?.peer_last_active_at) || undefined,
    favorite: Boolean(raw?.favorite),
    muted: Boolean(raw?.muted),
    isEnterpriseDefault: Boolean(raw?.is_enterprise_default),
    enterpriseName: str(raw?.enterprise_name).trim() || undefined,
    pinnedMessageId: str(raw?.pinned_message_id) || undefined,
    pinnedMessage: str(raw?.pinned_message) || undefined,
    pinnedMessages: (() => {
      const list = Array.isArray(raw?.pinned_messages)
        ? raw.pinned_messages.map((p: any) => ({
            id: str(p?.id),
            body: str(p?.body ?? p?.content).trim() || "Pinned message",
            type: p?.type ? str(p.type) : undefined,
            seq: typeof p?.seq === "number" ? p.seq : undefined,
          })).filter((p: { id: string }) => p.id)
        : [];
      if (list.length) return list.sort((a: { seq?: number }, b: { seq?: number }) => (a.seq ?? 0) - (b.seq ?? 0));
      // Legacy single-pin fallback
      const id = str(raw?.pinned_message_id);
      if (!id) return [];
      return [{ id, body: str(raw?.pinned_message).trim() || "Pinned message" }];
    })(),
    friendNote: str(raw?.friend_note) || undefined,
    friendshipId: str(raw?.friendship_id) || undefined,
    friendTags: Array.isArray(raw?.friend_tags) ? raw.friend_tags.map(String) : undefined,
  };
}

/** Display title preferring friend note/alias over peer name. */
export function conversationDisplayName(c: Conversation): string {
  if (c.type === "dm" && c.friendNote) return c.friendNote;
  return c.title;
}

export function normalizeMessage(raw: any, currentUserId?: string): Message {
  const senderId = str(raw?.sender_id ?? raw?.from_user_id ?? raw?.user_id ?? raw?.senderId);
  const type = str(raw?.type, "text") || "text";
  const mediaUrl = str(raw?.media_url ?? raw?.mediaUrl) || undefined;
  let content = str(raw?.body ?? raw?.content ?? raw?.text);
  if (!content && type === "voice") content = "Voice message";
  if (!content && type === "image") content = "Photo";
  if (!content && type === "file") content = "File";
  return {
    id: str(raw?.id ?? raw?.message_id ?? raw?.client_msg_id ?? newUUID()),
    conversationId: str(raw?.conversation_id ?? raw?.conversationId),
    senderId,
    senderName: str(raw?.sender_name ?? raw?.display_name ?? raw?.nickname) || undefined,
    senderAvatar: str(raw?.sender_avatar ?? raw?.senderAvatar) || undefined,
    content,
    type,
    mediaUrl,
    createdAt: str(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp, new Date().toISOString()),
    mine: currentUserId ? senderId === currentUserId : undefined,
    clientMsgId: str(raw?.client_msg_id) || undefined,
    seq: typeof raw?.seq === "number" ? raw.seq : undefined,
    recalled: Boolean(raw?.recalled),
    replyToId: str(raw?.reply_to_id) || undefined,
    delivered: Boolean(raw?.delivered),
    read: Boolean(raw?.read),
    readBy: Array.isArray(raw?.read_by)
      ? raw.read_by.map((u: any) => ({
          userId: str(u?.user_id ?? u?.id),
          displayName: str(u?.display_name ?? u?.name, "User"),
          avatarUrl: str(u?.avatar_url) || undefined,
        }))
      : undefined,
    unreadBy: Array.isArray(raw?.unread_by)
      ? raw.unread_by.map((u: any) => ({
          userId: str(u?.user_id ?? u?.id),
          displayName: str(u?.display_name ?? u?.name, "User"),
          avatarUrl: str(u?.avatar_url) || undefined,
        }))
      : undefined,
    readCount: typeof raw?.read_count === "number" ? raw.read_count : undefined,
    memberCount: typeof raw?.member_count === "number" ? raw.member_count : undefined,
    editedAt: str(raw?.edited_at ?? raw?.editedAt) || undefined,
    mentions: Array.isArray(raw?.mentions) ? raw.mentions.map(String) : undefined,
    mentionAll: Boolean(raw?.mention_all ?? raw?.mentionAll),
    reactions: Array.isArray(raw?.reactions)
      ? raw.reactions.map((r: any) => ({
          emoji: str(r?.emoji),
          count: Number(r?.count) || 0,
          mine: Boolean(r?.mine),
          users: Array.isArray(r?.users)
            ? r.users.map((u: any) => ({
                id: str(u?.id),
                name: str(u?.name),
                avatarUrl: str(u?.avatar_url) || undefined,
              }))
            : [],
        }))
      : [],
  };
}

export function normalizeFriend(raw: any): Friend {
  const tags = Array.isArray(raw?.tags) ? raw.tags.map(String) : [];
  return {
    userId: str(raw?.user_id ?? raw?.friend_id ?? raw?.id),
    friendshipId: str(raw?.friendship_id ?? raw?.id),
    username: str(raw?.username),
    nickname: str(raw?.display_name ?? raw?.nickname ?? raw?.name ?? raw?.username, "Unknown"),
    avatarUrl: str(raw?.avatar_url ?? raw?.avatarUrl) || undefined,
    online: Boolean(raw?.online),
    status: str(raw?.status, "accepted"),
    incoming: Boolean(raw?.incoming),
    outgoing: Boolean(raw?.outgoing),
    note: str(raw?.note) || undefined,
    tags,
  };
}

export function mediaURL(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) {
    return path;
  }
  let base = "";
  if (typeof process.env.NEXT_PUBLIC_API_URL === "string") {
    base = process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    if (!base && typeof window !== "undefined") base = window.location.origin;
  } else if (typeof window !== "undefined") {
    base = `${window.location.protocol}//${window.location.hostname}:8080`;
  } else {
    base = "http://localhost:8080";
  }
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/** last-online label for offline peers. */
export function formatLastSeen(
  iso: string | undefined,
  t: Translate,
  locale: ResolvedLocale = "en"
): string {
  if (!iso) return t("presence.offline");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("presence.offline");
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return t("presence.lastSeenJustNow");
  if (diff < 3_600_000) return t("presence.lastSeenMinutes", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("presence.lastSeenHours", { n: Math.floor(diff / 3_600_000) });
  return t("presence.lastSeenDate", {
    date: formatShortDate(d, locale),
  });
}
