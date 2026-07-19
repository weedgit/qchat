export interface CurrentUser {
  id: string;
  phone: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
}

export interface Conversation {
  id: string;
  type: "dm" | "social_group" | "group" | string;
  title: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
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

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  content: string;
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
  reactions?: Reaction[];
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
    lastMessage:
      typeof last === "string" ? last : str(last?.content ?? last?.body ?? last?.text) || undefined,
    lastMessageAt: str(raw?.last_message_at ?? raw?.updated_at ?? last?.created_at) || undefined,
    unreadCount: Number(raw?.unread_count ?? raw?.unread ?? 0) || 0,
  };
}

export function normalizeMessage(raw: any, currentUserId?: string): Message {
  const senderId = str(raw?.sender_id ?? raw?.from_user_id ?? raw?.user_id ?? raw?.senderId);
  return {
    id: str(raw?.id ?? raw?.message_id ?? raw?.client_msg_id ?? crypto.randomUUID()),
    conversationId: str(raw?.conversation_id ?? raw?.conversationId),
    senderId,
    senderName: str(raw?.sender_name ?? raw?.display_name ?? raw?.nickname) || undefined,
    content: str(raw?.body ?? raw?.content ?? raw?.text),
    createdAt: str(raw?.created_at ?? raw?.createdAt ?? raw?.timestamp, new Date().toISOString()),
    mine: currentUserId ? senderId === currentUserId : undefined,
    clientMsgId: str(raw?.client_msg_id) || undefined,
    seq: typeof raw?.seq === "number" ? raw.seq : undefined,
    recalled: Boolean(raw?.recalled),
    replyToId: str(raw?.reply_to_id) || undefined,
    delivered: Boolean(raw?.delivered),
    read: Boolean(raw?.read),
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
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
