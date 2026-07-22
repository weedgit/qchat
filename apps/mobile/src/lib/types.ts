export interface CurrentUser {
  id: string;
  phone: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
  realName?: string;
  age?: number | null;
  region?: string;
  signature?: string;
  profileVisibility?: string;
  friendPrivacy?: string;
}

export interface Conversation {
  id: string;
  type: "dm" | "social_group" | "group" | string;
  title: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastMessageSender?: string;
  lastMessageMine?: boolean;
  /** True when the preview row's last message was recalled. */
  lastMessageRecalled?: boolean;
  unreadCount: number;
  mentionCount?: number;
  peerId?: string;
  peerOnline?: boolean;
  peerLastActiveAt?: string;
  favorite?: boolean;
  muted?: boolean;
  /** My membership role in this conversation (owner|admin|member). */
  role?: string;
  pinnedMessageId?: string;
  pinnedMessage?: string;
  /** All pins for this conversation, ordered by seq ascending (top→bottom). */
  pinnedMessages?: { id: string; body: string; type?: string; seq?: number }[];
  friendNote?: string;
  friendshipId?: string;
  friendTags?: string[];
}

export interface ReactionUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
  users?: ReactionUser[];
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
  failed?: boolean;
  clientMsgId?: string;
  seq?: number;
  recalled?: boolean;
  replyToId?: string;
  delivered?: boolean;
  read?: boolean;
  editedAt?: string;
  reactions?: Reaction[];
}

export interface Friend {
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
  const lastRecalled =
    typeof last === "object" && last != null ? Boolean(last.recalled) : false;
  let lastMessage =
    typeof last === "string" ? last : str(last?.content ?? last?.body ?? last?.text) || undefined;
  if (lastRecalled) lastMessage = "Message recalled";
  return {
    id: str(raw?.id ?? raw?.conversation_id),
    type: typ,
    title,
    avatarUrl: str(raw?.avatar_url ?? raw?.avatarUrl) || undefined,
    lastMessage,
    lastMessageAt: str(raw?.last_message_at ?? raw?.updated_at ?? last?.created_at) || undefined,
    lastMessageSender: str(raw?.last_message_sender) || undefined,
    lastMessageMine: Boolean(raw?.last_message_mine),
    lastMessageRecalled: lastRecalled,
    unreadCount: Number(raw?.unread_count ?? raw?.unread ?? 0) || 0,
    mentionCount: Number(raw?.mention_count ?? 0) || 0,
    peerId: str(raw?.peer_id) || undefined,
    peerOnline: raw?.peer_online != null ? Boolean(raw.peer_online) : undefined,
    peerLastActiveAt: str(raw?.peer_last_active_at) || undefined,
    favorite: Boolean(raw?.favorite),
    muted: Boolean(raw?.muted),
    role: str(raw?.role) || undefined,
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
      const id = str(raw?.pinned_message_id);
      if (!id) return [];
      return [{ id, body: str(raw?.pinned_message).trim() || "Pinned message" }];
    })(),
    friendNote: str(raw?.friend_note) || undefined,
    friendshipId: str(raw?.friendship_id) || undefined,
    friendTags: Array.isArray(raw?.friend_tags) ? raw.friend_tags.map(String) : undefined,
  };
}

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
    id: str(raw?.id ?? raw?.message_id ?? raw?.client_msg_id ?? `${Date.now()}`),
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
    editedAt: str(raw?.edited_at ?? raw?.editedAt) || undefined,
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
