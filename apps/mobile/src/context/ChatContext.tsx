import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { router } from "expo-router";
import { formatApiErrorLocale, formatSystemNotice } from "@qchat/i18n";
import { api, asList, ensureAccessToken, getToken, uploadMedia, wsUrl } from "../lib/api";
import { notificationPort } from "../lib/notifyPort";
import { loadLocalNotifyProps, getNotifyProps, shouldNotify, saveLocalNotifyProps, normalizeNotifyProps } from "../lib/notifyProps";
import {
  Conversation,
  Friend,
  Message,
  normalizeConversation,
  normalizeFriend,
  normalizeMessage,
} from "../lib/types";
import { useAuth } from "./AuthContext";

/** Mirror web useChat prefs sort: favorites first, then lastMessageAt desc. */
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return (b.lastMessageAt || "").localeCompare(a.lastMessageAt || "");
  });
}

export type TypingUser = { userId: string; name: string };
export type PresenceEntry = { online: boolean; lastActiveAt?: string };

type ChatContextValue = {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  connected: boolean;
  loadError: string | null;
  typingByConv: Record<string, TypingUser[]>;
  presenceByUser: Record<string, PresenceEntry>;
  friends: Friend[];
  loadConversations: () => Promise<Conversation[]>;
  loadMessages: (convId: string) => Promise<void>;
  loadOlderMessages: (convId: string) => Promise<number>;
  loadFriends: () => Promise<Friend[]>;
  hasMoreByConv: Record<string, boolean>;
  openConversation: (convId: string) => void;
  closeConversation: (convId?: string) => void;
  activeId: string | null;
  sendMessage: (convId: string, content: string, replyToId?: string) => Promise<void>;
  sendMediaMessage: (
    convId: string,
    localUri: string,
    opts: {
      kind: "image" | "file";
      name: string;
      mimeType?: string;
      replyToId?: string;
      caption?: string;
    }
  ) => Promise<void>;
  sendRemoteImage: (
    convId: string,
    mediaUrl: string,
    caption: string,
    replyToId?: string
  ) => Promise<void>;
  sendVoiceMessage: (
    convId: string,
    localUri: string,
    durationSec: number,
    replyToId?: string
  ) => Promise<void>;
  retryMessage: (convId: string, msg: Message) => Promise<void>;
  cancelUpload: (convId: string, msg: Message) => void;
  notifyTyping: (convId: string) => void;
  stopTyping: (convId: string) => void;
  openDM: (userId: string) => Promise<string>;
  recallMessage: (messageId: string, convId: string) => Promise<void>;
  reactMessage: (messageId: string, convId: string, emoji: string) => Promise<void>;
  pinMessage: (messageId: string, convId: string, pin: boolean) => Promise<void>;
  editMessage: (messageId: string, convId: string, body: string) => Promise<void>;
  updateConversationPrefs: (
    convId: string,
    prefs: { favorite?: boolean; muted?: boolean }
  ) => Promise<void>;
  markConversationRead: (convId: string) => Promise<void>;
  markUnread: (convId: string) => Promise<void>;
  clearHistory: (convId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  forwardMessage: (messageId: string, conversationIds: string[]) => Promise<void>;
  leaveGroup: (conversationId: string) => Promise<void>;
  blockUser: (friendshipOrPeerId: string) => Promise<void>;
  unblockUser: (friendshipOrPeerId: string) => Promise<void>;
  /** Fan-out for non-chat WS events (e.g. call.*). Mirror web subscribeEvents. */
  subscribeEvents: (handler: (type: string, payload: any) => void) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { signedIn, user, forceLocalSignOut } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasMoreByConv, setHasMoreByConv] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [typingByConv, setTypingByConv] = useState<Record<string, TypingUser[]>>({});
  const [presenceByUser, setPresenceByUser] = useState<Record<string, PresenceEntry>>({});
  const [friends, setFriends] = useState<Friend[]>([]);

  const meRef = useRef(user);
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const messagesRef = useRef(messages);
  const hasMoreRef = useRef<Record<string, boolean>>({});
  const loadingOlderRef = useRef<Record<string, boolean>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const kickedRef = useRef(false);
  const handleIncomingRef = useRef<(raw: any) => void>(() => {});
  const eventListenersRef = useRef(new Set<(type: string, payload: any) => void>());
  const markConversationReadRef = useRef<(convId: string) => Promise<void>>(async () => {});
  const typingExpiryRef = useRef<Record<string, Record<string, ReturnType<typeof setTimeout>>>>({});
  const lastTypingSentRef = useRef<Record<string, number>>({});
  const typingActiveRef = useRef<Record<string, boolean>>({});
  const typingIdleRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const appActiveRef = useRef(true);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const cancelledUploadsRef = useRef(new Set<string>());

  meRef.current = user;
  activeIdRef.current = activeId;
  conversationsRef.current = conversations;
  messagesRef.current = messages;
  hasMoreRef.current = hasMoreByConv;

  useEffect(() => {
    if (signedIn) kickedRef.current = false;
  }, [signedIn]);

  const wsSend = useCallback((type: string, payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch {
      /* ignore */
    }
  }, []);

  const clearTypingUser = useCallback((convId: string, userId: string) => {
    const byUser = typingExpiryRef.current[convId];
    if (byUser?.[userId]) {
      clearTimeout(byUser[userId]);
      delete byUser[userId];
    }
    setTypingByConv((prev) => {
      const list = (prev[convId] ?? []).filter((u) => u.userId !== userId);
      if (list.length === (prev[convId] ?? []).length) return prev;
      if (list.length === 0) {
        const next = { ...prev };
        delete next[convId];
        return next;
      }
      return { ...prev, [convId]: list };
    });
  }, []);

  const upsertTypingUser = useCallback(
    (convId: string, userId: string, name: string) => {
      if (!convId || !userId || userId === meRef.current?.id) return;
      if (!typingExpiryRef.current[convId]) typingExpiryRef.current[convId] = {};
      const existing = typingExpiryRef.current[convId][userId];
      if (existing) clearTimeout(existing);
      typingExpiryRef.current[convId][userId] = setTimeout(() => {
        clearTypingUser(convId, userId);
      }, 3500);
      setTypingByConv((prev) => {
        const list = prev[convId] ?? [];
        const without = list.filter((u) => u.userId !== userId);
        return { ...prev, [convId]: [...without, { userId, name }] };
      });
    },
    [clearTypingUser]
  );

  const stopTyping = useCallback(
    (convId: string) => {
      if (!convId) return;
      const idle = typingIdleRef.current[convId];
      if (idle) {
        clearTimeout(idle);
        delete typingIdleRef.current[convId];
      }
      if (!typingActiveRef.current[convId]) return;
      typingActiveRef.current[convId] = false;
      wsSend("typing.stop", { conversation_id: convId });
    },
    [wsSend]
  );

  const notifyTyping = useCallback(
    (convId: string) => {
      if (!convId) return;
      const now = Date.now();
      const last = lastTypingSentRef.current[convId] ?? 0;
      if (!typingActiveRef.current[convId] || now - last > 2500) {
        typingActiveRef.current[convId] = true;
        lastTypingSentRef.current[convId] = now;
        wsSend("typing.start", { conversation_id: convId });
      }
      const prevIdle = typingIdleRef.current[convId];
      if (prevIdle) clearTimeout(prevIdle);
      typingIdleRef.current[convId] = setTimeout(() => stopTyping(convId), 3000);
    },
    [stopTyping, wsSend]
  );

  const loadConversations = useCallback(async () => {
    try {
      const body = await api<any>("/v1/conversations");
      const list = sortConversations(asList(body, "conversations").map(normalizeConversation));
      setConversations(list);
      setPresenceByUser((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (!c.peerId) continue;
          next[c.peerId] = {
            online: Boolean(c.peerOnline),
            lastActiveAt: c.peerLastActiveAt || next[c.peerId]?.lastActiveAt,
          };
        }
        return next;
      });
      setLoadError(null);
      return list;
    } catch (e: unknown) {
      setLoadError(formatApiErrorLocale(e, undefined, "api.err.loadFailed"));
      return [] as Conversation[];
    }
  }, []);

  const loadFriends = useCallback(async () => {
    try {
      const body = await api<any>("/v1/friends");
      const list = asList(body, "friends").map(normalizeFriend);
      setFriends(list);
      setPresenceByUser((prev) => {
        const next = { ...prev };
        for (const f of list) {
          if (!f.userId) continue;
          next[f.userId] = {
            online: Boolean(f.online),
            lastActiveAt: next[f.userId]?.lastActiveAt,
          };
        }
        return next;
      });
      return list;
    } catch {
      return [] as Friend[];
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const body = await api<any>(`/v1/conversations/${convId}/messages?limit=50`);
      const list = asList(body, "messages")
        .map((m: any) => normalizeMessage(m, meRef.current?.id))
        .sort((a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt));
      setMessages((prev) => ({ ...prev, [convId]: list }));
      const more = Boolean(body?.has_more);
      hasMoreRef.current = { ...hasMoreRef.current, [convId]: more };
      setHasMoreByConv((prev) => ({ ...prev, [convId]: more }));
      const last = list[list.length - 1];
      // Only mark read while this chat is the focused screen (not prefetch / stale active).
      if (last && !last.mine && activeIdRef.current === convId) {
        api(`/v1/messages/${last.id}/read`, { method: "POST" }).catch(() => {});
      }
      // Keep list preview aligned with loaded history (incl. recalls).
      if (last) {
        setConversations((prev) =>
          sortConversations(
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    lastMessage: last.recalled ? "Message recalled" : last.content || c.lastMessage,
                    lastMessageAt: last.createdAt || c.lastMessageAt,
                    lastMessageSender: last.mine
                      ? meRef.current?.nickname || meRef.current?.username
                      : last.senderName,
                    lastMessageMine: Boolean(last.mine),
                    lastMessageRecalled: Boolean(last.recalled),
                  }
                : c
            )
          )
        );
      }
    } catch (e: unknown) {
      setLoadError(formatApiErrorLocale(e, undefined, "api.err.loadFailed"));
    }
  }, []);

  const loadOlderMessages = useCallback(async (convId: string): Promise<number> => {
    if (loadingOlderRef.current[convId]) return 0;
    if (hasMoreRef.current[convId] === false) return 0;
    const existing = messagesRef.current[convId] ?? [];
    const oldest = existing.find((m) => typeof m.seq === "number" && !m.pending);
    if (!oldest?.seq) return 0;
    loadingOlderRef.current[convId] = true;
    try {
      const body = await api<any>(
        `/v1/conversations/${convId}/messages?limit=50&before_seq=${oldest.seq}`
      );
      const older = asList(body, "messages")
        .map((m: any) => normalizeMessage(m, meRef.current?.id))
        .sort((a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt));
      const more = Boolean(body?.has_more);
      hasMoreRef.current = { ...hasMoreRef.current, [convId]: more };
      setHasMoreByConv((prev) => ({ ...prev, [convId]: more }));
      if (older.length === 0) return 0;
      setMessages((prev) => {
        const cur = prev[convId] ?? [];
        const seen = new Set(cur.map((m) => m.id));
        return { ...prev, [convId]: [...older.filter((m) => !seen.has(m.id)), ...cur] };
      });
      return older.length;
    } catch {
      return 0;
    } finally {
      loadingOlderRef.current[convId] = false;
    }
  }, []);

  const openConversation = useCallback(
    (convId: string) => {
      activeIdRef.current = convId;
      setActiveId(convId);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0, mentionCount: 0 } : c))
      );
      loadMessages(convId);
    },
    [loadMessages]
  );

  /** Clear active chat so background WS traffic does not auto-mark as read. */
  const closeConversation = useCallback((convId?: string) => {
    if (convId && activeIdRef.current !== convId) return;
    activeIdRef.current = null;
    setActiveId(null);
  }, []);

  const handleIncoming = useCallback(
    (raw: any) => {
      const type = String(raw?.type ?? "");
      const payload = raw?.payload ?? raw?.data ?? raw;

      // Same-type login / remote revoke — sign out immediately (mirror web).
      if (type === "session.revoked") {
        kickedRef.current = true;
        if (retryRef.current) {
          clearTimeout(retryRef.current);
          retryRef.current = null;
        }
        const ws = wsRef.current;
        if (ws) {
          try {
            ws.onclose = null;
            ws.close();
          } catch {
            /* ignore */
          }
          wsRef.current = null;
        }
        setConnected(false);
        void forceLocalSignOut(String(payload?.reason || "replaced"));
        try {
          router.replace("/login");
        } catch {
          /* ignore */
        }
        return;
      }

 // Calls signaling → useCall (mirror web useChat).
      if (type.startsWith("call.")) {
        eventListenersRef.current.forEach((fn) => {
          try {
            fn(type, payload);
          } catch {
            /* ignore listener errors */
          }
        });
        return;
      }

      if (type === "typing.start") {
        const convId = String(payload?.conversation_id ?? "");
        const userId = String(payload?.user_id ?? "");
        const name = String(payload?.user_name ?? payload?.name ?? "Someone");
        upsertTypingUser(convId, userId, name);
        return;
      }
      if (type === "typing.stop") {
        const convId = String(payload?.conversation_id ?? "");
        const userId = String(payload?.user_id ?? "");
        if (convId && userId) clearTypingUser(convId, userId);
        return;
      }

      // Mattermost-style status_change equivalent.
      if (type === "presence.update" || type === "status_change") {
        const userId = String(payload?.user_id ?? "");
        if (!userId) return;
        const online = Boolean(payload?.online ?? payload?.status === "online");
        const lastActiveAt = String(payload?.last_active_at ?? "") || undefined;
        setPresenceByUser((prev) => ({
          ...prev,
          [userId]: { online, lastActiveAt: lastActiveAt || prev[userId]?.lastActiveAt },
        }));
        setConversations((prev) =>
          prev.map((c) =>
            c.peerId === userId
              ? { ...c, peerOnline: online, peerLastActiveAt: lastActiveAt || c.peerLastActiveAt }
              : c
          )
        );
        setFriends((prev) =>
          prev.map((f) => (f.userId === userId ? { ...f, online } : f))
        );
        return;
      }

      if (type === "friend.request" || type === "friend.blocked") {
        eventListenersRef.current.forEach((fn) => {
          try {
            fn(type, payload);
          } catch {
            /* ignore */
          }
        });
        void loadFriends();
        // Incoming pending request — local OS banner (WS path while app is alive).
        if (type === "friend.request") {
          const status = String(payload?.status ?? "pending");
          if (status === "pending" || status === "") {
            const who =
              String(payload?.from_name ?? "").trim() ||
              (String(payload?.from_username ?? "").trim()
                ? `@${String(payload.from_username).trim()}`
                : "") ||
              "Someone";
            notificationPort
              .presentForegroundMessage({
                title: "Friend request",
                body: `${who} wants to add you as a contact`,
                path: "/(tabs)/contacts",
                sound: true,
              })
              .catch(() => {});
          }
        }
        if (type === "friend.blocked") {
          const peerId = String(payload?.peer_id ?? payload?.from ?? "");
          if (peerId) {
            setConversations((prev) => {
              const next = prev.filter(
                (c) => c.type !== "dm" || (c.peerId !== peerId && c.friendshipId !== peerId)
              );
              const removed = prev.filter((c) => !next.some((n) => n.id === c.id));
              if (removed.length) {
                setActiveId((cur) => (removed.some((c) => c.id === cur) ? null : cur));
                setMessages((msgs) => {
                  const copy = { ...msgs };
                  for (const c of removed) delete copy[c.id];
                  return copy;
                });
              }
              return next;
            });
          } else {
            void loadConversations();
          }
        }
        return;
      }

      if (type === "message.reaction") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        const emoji = String(payload?.emoji ?? "");
        const count = Number(payload?.count) || 0;
        const by = String(payload?.by ?? "");
        const added = Boolean(payload?.added);
        if (!id || !convId || !emoji) return;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) => {
            if (m.id !== id) return m;
            const rest = (m.reactions ?? []).filter((x) => x.emoji !== emoji);
            const existing = (m.reactions ?? []).find((x) => x.emoji === emoji);
            const mine = by === meRef.current?.id ? added : existing?.mine ?? false;
            let users = (existing?.users ?? []).filter((u) => u.id !== by);
            if (added) {
              users = [
                ...users,
                {
                  id: by,
                  name: String(payload?.by_name ?? ""),
                  avatarUrl: String(payload?.by_avatar ?? "") || undefined,
                },
              ];
            }
            return {
              ...m,
              reactions: count > 0 ? [...rest, { emoji, count, mine, users }] : rest,
            };
          }),
        }));
        return;
      }

      // Mirror web useChat message.recalled
      if (type === "message.recalled") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        const recalledBody = String(payload?.body ?? "");
        if (!id || !convId) return;
        const list = messagesRef.current[convId] ?? [];
        const wasLast = list.length > 0 && list[list.length - 1]?.id === id;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === id
              ? { ...m, content: recalledBody, recalled: true, mediaUrl: undefined }
              : m
          ),
        }));
        if (wasLast) {
          setConversations((prev) =>
            sortConversations(
              prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      lastMessage: "Message recalled",
                      lastMessageRecalled: true,
                    }
                  : c
              )
            )
          );
        }
        return;
      }

      // Groups: ordinary members get silent remove (requirements — no recall notice).
      if (type === "message.removed") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        if (!id || !convId) return;
        const list = messagesRef.current[convId] ?? [];
        const wasLast = list.length > 0 && list[list.length - 1]?.id === id;
        const nextList = list.filter((m) => m.id !== id);
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).filter((m) => m.id !== id),
        }));
        if (wasLast) {
          const newLast = nextList[nextList.length - 1];
          setConversations((prev) =>
            sortConversations(
              prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      lastMessage: newLast
                        ? newLast.recalled
                          ? "Message recalled"
                          : newLast.content || ""
                        : "",
                      lastMessageAt: newLast?.createdAt || c.lastMessageAt,
                      lastMessageSender: newLast
                        ? newLast.mine
                          ? meRef.current?.nickname || meRef.current?.username
                          : newLast.senderName
                        : c.lastMessageSender,
                      lastMessageMine: Boolean(newLast?.mine),
                      lastMessageRecalled: Boolean(newLast?.recalled),
                    }
                  : c
              )
            )
          );
        }
        return;
      }

      if (type === "message.updated") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        const body = String(payload?.body ?? "");
        const editedAt = String(payload?.edited_at ?? new Date().toISOString());
        if (!id || !convId) return;
        const list = messagesRef.current[convId] ?? [];
        const wasLast = list.length > 0 && list[list.length - 1]?.id === id;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === id ? { ...m, content: body, editedAt } : m
          ),
        }));
        if (wasLast) {
          setConversations((prev) =>
            sortConversations(
              prev.map((c) =>
                c.id === convId ? { ...c, lastMessage: body, lastMessageRecalled: false } : c
              )
            )
          );
        }
        return;
      }

      if (type === "message.pinned") {
        const convId = String(payload?.conversation_id ?? "");
        const messageId = String(payload?.message_id ?? "");
        const body = String(payload?.body ?? "").trim() || "Pinned message";
        if (!convId || !messageId) return;
        const pins = Array.isArray(payload?.pinned_messages)
          ? payload.pinned_messages
              .map((p: any) => ({
                id: String(p?.id ?? ""),
                body: String(p?.body ?? "").trim() || "Pinned message",
                type: p?.type ? String(p.type) : undefined,
                seq: typeof p?.seq === "number" ? p.seq : undefined,
              }))
              .filter((p: { id: string }) => p.id)
              .sort((a: { seq?: number }, b: { seq?: number }) => (a.seq ?? 0) - (b.seq ?? 0))
          : null;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const pinnedMessages =
              pins ??
              (() => {
                const rest = (c.pinnedMessages ?? []).filter((p) => p.id !== messageId);
                return [...rest, { id: messageId, body, type: String(payload?.type ?? ""), seq: Number(payload?.seq) || undefined }].sort(
                  (a, b) => (a.seq ?? 0) - (b.seq ?? 0)
                );
              })();
            const last = pinnedMessages[pinnedMessages.length - 1];
            return { ...c, pinnedMessages, pinnedMessageId: last?.id, pinnedMessage: last?.body };
          })
        );
        return;
      }

      if (type === "message.unpinned") {
        const convId = String(payload?.conversation_id ?? "");
        const messageId = String(payload?.message_id ?? "");
        if (!convId) return;
        const pins = Array.isArray(payload?.pinned_messages)
          ? payload.pinned_messages
              .map((p: any) => ({
                id: String(p?.id ?? ""),
                body: String(p?.body ?? "").trim() || "Pinned message",
                type: p?.type ? String(p.type) : undefined,
                seq: typeof p?.seq === "number" ? p.seq : undefined,
              }))
              .filter((p: { id: string }) => p.id)
              .sort((a: { seq?: number }, b: { seq?: number }) => (a.seq ?? 0) - (b.seq ?? 0))
          : null;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const pinnedMessages =
              pins ?? (c.pinnedMessages ?? []).filter((p) => p.id !== messageId);
            const last = pinnedMessages[pinnedMessages.length - 1];
            return {
              ...c,
              pinnedMessages,
              pinnedMessageId: last?.id,
              pinnedMessage: last?.body,
            };
          })
        );
        return;
      }

      if (type === "group.updated") {
        const convId = String(payload?.conversation_id ?? "");
        if (!convId) return;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const title = payload?.title != null ? String(payload.title) : c.title;
            const avatarUrl =
              payload?.avatar_url != null
                ? String(payload.avatar_url) || undefined
                : c.avatarUrl;
            const muteAll =
              payload?.mute_all != null ? Boolean(payload.mute_all) : c.muteAll;
            return { ...c, title, avatarUrl, muteAll };
          })
        );
        const addedRaw = payload?.added_member_ids;
        const meId = meRef.current?.id;
        if (meId && Array.isArray(addedRaw) && addedRaw.map(String).includes(meId)) {
          void loadConversations();
        }
        return;
      }

      if (type === "group.join_request" || type === "group.pending_changed") {
        eventListenersRef.current.forEach((fn) => {
          try {
            fn(type, payload);
          } catch {
            /* ignore listener errors */
          }
        });
        return;
      }

      if (type === "message.read") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        const by = String(payload?.by ?? "");
        const seq = Number(payload?.seq);
        if (!id || !convId) return;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) => {
            if (!m.mine) return m;
            const hit =
              m.id === id ||
              (Number.isFinite(seq) && seq > 0 && typeof m.seq === "number" && m.seq <= seq);
            if (!hit) return m;
            let readBy = m.readBy ? [...m.readBy] : [];
            let unreadBy = m.unreadBy ? [...m.unreadBy] : [];
            if (by) {
              const already = readBy.some((u) => u.userId === by);
              if (!already) {
                const fromUnread = unreadBy.find((u) => u.userId === by);
                if (fromUnread) {
                  readBy = [...readBy, fromUnread];
                  unreadBy = unreadBy.filter((u) => u.userId !== by);
                } else {
                  readBy = [...readBy, { userId: by, displayName: "User" }];
                }
              }
            }
            const memberCount = m.memberCount ?? readBy.length + unreadBy.length;
            const readCount = readBy.length;
            const allRead = memberCount > 0 && readCount >= memberCount;
            const hasLists = Boolean(m.readBy || m.unreadBy);
            return {
              ...m,
              delivered: true,
              read: hasLists ? allRead : true,
              readBy: hasLists ? readBy : m.readBy,
              unreadBy: hasLists ? unreadBy : m.unreadBy,
              readCount: hasLists ? readCount : m.readCount,
            };
          }),
        }));
        return;
      }

      if (type === "group.member_removed") {
        const convId = String(payload?.conversation_id ?? "");
        const removed = String(payload?.removed_user_id ?? "");
        const meId = meRef.current?.id;
        if (!convId) return;
        if (removed && meId && removed === meId) {
          setConversations((prev) => prev.filter((c) => c.id !== convId));
          setActiveId((cur) => (cur === convId ? null : cur));
          setMessages((prev) => {
            const next = { ...prev };
            delete next[convId];
            return next;
          });
        }
        return;
      }

      if (type === "message.delivered") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        if (!id || !convId) return;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === id ? { ...m, delivered: true } : m
          ),
        }));
        return;
      }

      if (!type.includes("message")) return;
      // message.removed handled above (group silent recall / delete)

      const msg = normalizeMessage(payload, meRef.current?.id);
      if (!msg.conversationId) return;
      if (!msg.content && !msg.mediaUrl && !msg.clientMsgId) return;
      const isSystem = msg.type === "system";

      setMessages((prev) => {
        const list = prev[msg.conversationId] ?? [];
        if (
          list.some(
            (m) => m.id === msg.id || (msg.clientMsgId && m.clientMsgId === msg.clientMsgId)
          )
        ) {
          return {
            ...prev,
            [msg.conversationId]: list.map((m) => {
              if (m.clientMsgId && m.clientMsgId === msg.clientMsgId) {
                return {
                  ...msg,
                  mine: true,
                  pending: false,
                  failed: false,
                  replyToId: msg.replyToId || m.replyToId,
                  mediaUrl: msg.mediaUrl || m.mediaUrl,
                };
              }
              if (m.id === msg.id) {
                return {
                  ...m,
                  ...msg,
                  pending: false,
                  failed: false,
                  replyToId: msg.replyToId || m.replyToId,
                  mediaUrl: msg.mediaUrl || m.mediaUrl,
                };
              }
              return m;
            }),
          };
        }
        return { ...prev, [msg.conversationId]: [...list, msg] };
      });

      setConversations((prev) => {
        const exists = prev.some((c) => c.id === msg.conversationId);
        if (!exists) {
          loadConversations();
          return prev;
        }
        return sortConversations(
          prev.map((c) =>
            c.id === msg.conversationId
              ? {
                  ...c,
                  lastMessage: msg.recalled
                    ? "Message recalled"
                    : isSystem
                      ? formatSystemNotice(msg.content)
                      : msg.content || c.lastMessage,
                  lastMessageAt: msg.createdAt,
                  lastMessageSender: msg.mine
                    ? meRef.current?.nickname || meRef.current?.username
                    : msg.senderName,
                  lastMessageMine: Boolean(msg.mine),
                  lastMessageRecalled: Boolean(msg.recalled),
                  unreadCount:
                    c.id === activeIdRef.current || msg.mine || isSystem
                      ? c.unreadCount
                      : c.unreadCount + 1,
                  mentionCount:
                    c.id === activeIdRef.current || msg.mine || isSystem
                      ? c.mentionCount ?? 0
                      : (() => {
                          const isMention =
                            Boolean(payload?.mention_all) ||
                            (Array.isArray(payload?.mentions) &&
                              payload.mentions.includes(meRef.current?.id));
                          return (c.mentionCount ?? 0) + (isMention ? 1 : 0);
                        })(),
                }
              : c
          )
        );
      });

      if (!msg.mine && msg.id) {
        api(`/v1/messages/${msg.id}/delivered`, { method: "POST" }).catch(() => {});
        if (activeIdRef.current === msg.conversationId && appActiveRef.current) {
          api(`/v1/messages/${msg.id}/read`, { method: "POST" }).catch(() => {});
        } else {
          const conversation = conversationsRef.current.find((c) => c.id === msg.conversationId);
          const meId = meRef.current?.id;
          const mentionList = Array.isArray(payload?.mentions)
            ? payload.mentions.map((x: unknown) => String(x))
            : [];
          const isMention =
            Boolean(payload?.mention_all) ||
            (Boolean(meId) && mentionList.includes(String(meId)));
          const notify = getNotifyProps();
          if (
            !shouldNotify(notify, {
              muted: conversation?.muted,
              isMention,
            })
          ) {
            return;
          }
          const sender = msg.senderName || conversation?.title || "New message";
          const target =
            conversation?.type === "dm"
              ? meRef.current?.nickname ?? ""
              : conversation?.title ?? "";
          let title = target ? `${sender} → ${target}` : sender;
          if (isMention) {
            title = Boolean(payload?.mention_all)
              ? `Mentioned everyone · ${title}`
              : `Mentioned you · ${title}`;
          }
          notificationPort
            .presentForegroundMessage({
              conversationId: msg.conversationId,
              title,
              body: msg.content || "New message",
              sound: notify.sound,
            })
            .catch(() => {});
        }
      }
    },
    [loadConversations, loadFriends, forceLocalSignOut, clearTypingUser, upsertTypingUser]
  );

  handleIncomingRef.current = handleIncoming;

  useEffect(() => {
    if (!signedIn || !getToken()) {
      setConversations([]);
      setMessages({});
      setConnected(false);
      return;
    }

    loadConversations();
    void loadFriends();
    void notificationPort.ensureLocalPermission().catch(() => {});
    void notificationPort.registerRemote().catch(() => {});
    const detachNotifyTap = notificationPort.attachTapListener();
    // Hydrate notify prefs so mention/all switcher applies to local banners.
    loadLocalNotifyProps()
      .then(async () => {
        try {
          const p = await api<any>("/v1/me/notify_props");
          await saveLocalNotifyProps(normalizeNotifyProps(p));
        } catch {
          /* keep SecureStore / defaults */
        }
      })
      .catch(() => {});

    let disposed = false;

    async function connect() {
      if (disposed) return;
      const authed = await ensureAccessToken();
      if (disposed) return;
      if (!authed || !getToken()) {
        setConnected(false);
        retryRef.current = setTimeout(connect, Math.min(backoffRef.current, 15000));
        backoffRef.current = Math.min(backoffRef.current * 2, 15000);
        return;
      }
      if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {
          /* ignore */
        }
      }
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) return;
        setConnected(true);
        backoffRef.current = 1000;
      };
      ws.onmessage = (ev) => {
        try {
          handleIncomingRef.current(JSON.parse(String(ev.data)));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setConnected(false);
        }
        if (!disposed && !kickedRef.current) {
          const delay = Math.min(backoffRef.current, 15000);
          backoffRef.current = Math.min(delay * 2, 15000);
          retryRef.current = setTimeout(connect, delay);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      detachNotifyTap();
      if (retryRef.current) clearTimeout(retryRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [signedIn, loadConversations, loadFriends]);

  // Foreground catch-up: mark focused chat read when returning to the app.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      const active = state === "active";
      appActiveRef.current = active;
      if (active && activeIdRef.current) {
        void markConversationReadRef.current(activeIdRef.current);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  const sendMessage = useCallback(async (convId: string, content: string, replyToId?: string) => {
    stopTyping(convId);
    const { clipMessageText } = await import("../lib/mediaLimits");
    const text = clipMessageText(content);
    if (!text.trim()) return;
    const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: clientMsgId,
      conversationId: convId,
      senderId: meRef.current?.id ?? "me",
      content: text,
      type: "text",
      createdAt: new Date().toISOString(),
      mine: true,
      pending: true,
      clientMsgId,
      replyToId,
    };
    setMessages((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] ?? []), optimistic],
    }));
    setConversations((prev) =>
      sortConversations(
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                lastMessage: text,
                lastMessageAt: optimistic.createdAt,
                lastMessageSender: meRef.current?.nickname || meRef.current?.username,
                lastMessageMine: true,
                lastMessageRecalled: false,
              }
            : c
        )
      )
    );
    try {
      const body = await api<any>(`/v1/conversations/${convId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          type: "text",
          body: text,
          client_msg_id: clientMsgId,
          reply_to_id: replyToId || undefined,
        }),
      });
      const saved = normalizeMessage(
        {
          ...body,
          conversation_id: convId,
          body: body?.body ?? text,
          sender_id: meRef.current?.id,
        },
        meRef.current?.id
      );
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === clientMsgId || m.clientMsgId === clientMsgId
            ? { ...saved, mine: true, pending: false, failed: false, clientMsgId, replyToId }
            : m
        ),
      }));
    } catch (e: any) {
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === clientMsgId
            ? { ...m, pending: false, failed: true, error: e?.message || "Send failed" }
            : m
        ),
      }));
    }
  }, [stopTyping]);

  const cancelUpload = useCallback((convId: string, msg: Message) => {
    const key = msg.clientMsgId || msg.id;
    cancelledUploadsRef.current.add(key);
    const controller = uploadControllersRef.current.get(key);
    if (controller) {
      controller.abort();
      uploadControllersRef.current.delete(key);
    }
    setMessages((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).filter((m) => m.id !== msg.id && m.clientMsgId !== key),
    }));
  }, []);

  const sendMediaMessage = useCallback(
    async (
      convId: string,
      localUri: string,
      opts: {
        kind: "image" | "file";
        name: string;
        mimeType?: string;
        replyToId?: string;
        caption?: string;
      }
    ) => {
      stopTyping(convId);
      const { kind, name, mimeType, replyToId } = opts;
      const { clipMessageText, isVideoMime: isVid } = await import("../lib/mediaLimits");
      const isVideo = kind === "file" && isVid(mimeType);
      const uploadKind = kind === "image" ? "image" : isVideo ? "video" : "file";
      const trimmedCaption = clipMessageText(opts.caption?.trim() || "");
      const preview =
        kind === "image"
          ? trimmedCaption || "Photo"
          : trimmedCaption || name || (isVideo ? "Video" : "File");
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      uploadControllersRef.current.set(clientMsgId, controller);
      const optimistic: Message = {
        id: clientMsgId,
        conversationId: convId,
        senderId: meRef.current?.id ?? "me",
        content: preview,
        type: kind,
        mediaUrl: localUri,
        createdAt: new Date().toISOString(),
        mine: true,
        pending: true,
        uploadProgress: 0,
        clientMsgId,
        replyToId,
        localUri,
        localMimeType: mimeType,
        localName: name,
      };
      setMessages((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), optimistic],
      }));
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  lastMessage: preview,
                  lastMessageAt: optimistic.createdAt,
                  lastMessageSender: meRef.current?.nickname || meRef.current?.username,
                  lastMessageMine: true,
                  lastMessageRecalled: false,
                }
              : c
          )
        )
      );
      try {
        let lastPct = -1;
        const uploaded = await uploadMedia(
          localUri,
          uploadKind,
          name || (kind === "image" ? "photo.jpg" : isVideo ? "video.mp4" : "file.bin"),
          mimeType ||
            (kind === "image"
              ? "image/jpeg"
              : isVideo
                ? "video/mp4"
                : "application/octet-stream"),
          (loaded, total) => {
            if (cancelledUploadsRef.current.has(clientMsgId)) return;
            const pct = Math.min(1, loaded / total);
            const stepped = Math.floor(pct * 20);
            if (stepped === lastPct) return;
            lastPct = stepped;
            setMessages((prev) => ({
              ...prev,
              [convId]: (prev[convId] ?? []).map((m) =>
                m.id === clientMsgId || m.clientMsgId === clientMsgId
                  ? { ...m, uploadProgress: pct }
                  : m
              ),
            }));
          },
          controller.signal
        );
        if (controller.signal.aborted || cancelledUploadsRef.current.has(clientMsgId)) {
          uploadControllersRef.current.delete(clientMsgId);
          cancelledUploadsRef.current.delete(clientMsgId);
          return;
        }
        const body = await api<any>(`/v1/conversations/${convId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            type: kind,
            body: preview,
            media_url: uploaded.url,
            client_msg_id: clientMsgId,
            reply_to_id: replyToId || undefined,
          }),
        });
        if (cancelledUploadsRef.current.has(clientMsgId)) {
          uploadControllersRef.current.delete(clientMsgId);
          cancelledUploadsRef.current.delete(clientMsgId);
          return;
        }
        const saved = normalizeMessage(
          {
            ...body,
            conversation_id: convId,
            type: kind,
            body: body?.body ?? preview,
            media_url: body?.media_url ?? uploaded.url,
            sender_id: meRef.current?.id,
          },
          meRef.current?.id
        );
        uploadControllersRef.current.delete(clientMsgId);
        cancelledUploadsRef.current.delete(clientMsgId);
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId || m.clientMsgId === clientMsgId
              ? {
                  ...saved,
                  mine: true,
                  pending: false,
                  failed: false,
                  uploadProgress: undefined,
                  localUri: undefined,
                  localMimeType: undefined,
                  localName: undefined,
                  clientMsgId,
                  replyToId,
                }
              : m
          ),
        }));
      } catch (e: any) {
        uploadControllersRef.current.delete(clientMsgId);
        const cancelled =
          controller.signal.aborted ||
          cancelledUploadsRef.current.has(clientMsgId) ||
          e?.message === "upload aborted";
        cancelledUploadsRef.current.delete(clientMsgId);
        if (cancelled) {
          setMessages((prev) => ({
            ...prev,
            [convId]: (prev[convId] ?? []).filter(
              (m) => m.id !== clientMsgId && m.clientMsgId !== clientMsgId
            ),
          }));
          return;
        }
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId
              ? {
                  ...m,
                  pending: false,
                  failed: true,
                  uploadProgress: undefined,
                  error: e?.message || "Upload failed",
                }
              : m
          ),
        }));
      }
    },
    [stopTyping]
  );

  const sendRemoteImage = useCallback(
    async (convId: string, mediaUrl: string, caption: string, replyToId?: string) => {
      stopTyping(convId);
      const { clipMessageText } = await import("../lib/mediaLimits");
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = clipMessageText(caption.trim() || "Photo");
      const optimistic: Message = {
        id: clientMsgId,
        conversationId: convId,
        senderId: meRef.current?.id ?? "me",
        content: preview,
        type: "image",
        mediaUrl,
        createdAt: new Date().toISOString(),
        mine: true,
        pending: true,
        clientMsgId,
        replyToId,
      };
      setMessages((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), optimistic],
      }));
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  lastMessage: preview,
                  lastMessageAt: optimistic.createdAt,
                  lastMessageSender: meRef.current?.nickname || meRef.current?.username,
                  lastMessageMine: true,
                  lastMessageRecalled: false,
                }
              : c
          )
        )
      );
      try {
        const body = await api<any>(`/v1/conversations/${convId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            type: "image",
            body: preview,
            media_url: mediaUrl,
            client_msg_id: clientMsgId,
            reply_to_id: replyToId || undefined,
          }),
        });
        const saved = normalizeMessage(
          {
            ...body,
            conversation_id: convId,
            media_url: body?.media_url ?? mediaUrl,
            type: "image",
            body: body?.body ?? preview,
            sender_id: meRef.current?.id,
          },
          meRef.current?.id
        );
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.clientMsgId === clientMsgId
              ? { ...saved, mine: true, pending: false, failed: false, clientMsgId, replyToId }
              : m
          ),
        }));
      } catch (e: any) {
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.clientMsgId === clientMsgId
              ? { ...m, pending: false, failed: true, error: e?.message || "Send failed" }
              : m
          ),
        }));
      }
    },
    [stopTyping]
  );

  const sendVoiceMessage = useCallback(
    async (convId: string, localUri: string, durationSec: number, replyToId?: string) => {
      stopTyping(convId);
      const preview = `Voice message (${Math.max(1, Math.round(durationSec))}s)`;
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      uploadControllersRef.current.set(clientMsgId, controller);
      const optimistic: Message = {
        id: clientMsgId,
        conversationId: convId,
        senderId: meRef.current?.id ?? "me",
        content: preview,
        type: "voice",
        mediaUrl: localUri,
        createdAt: new Date().toISOString(),
        mine: true,
        pending: true,
        uploadProgress: 0,
        clientMsgId,
        replyToId,
        localUri,
      };
      setMessages((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), optimistic],
      }));
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  lastMessage: preview,
                  lastMessageAt: optimistic.createdAt,
                  lastMessageSender: meRef.current?.nickname || meRef.current?.username,
                  lastMessageMine: true,
                  lastMessageRecalled: false,
                }
              : c
          )
        )
      );
      try {
        let lastPct = -1;
        const uploaded = await uploadMedia(
          localUri,
          "voice",
          "voice.m4a",
          "audio/mp4",
          (loaded, total) => {
            if (cancelledUploadsRef.current.has(clientMsgId)) return;
            const pct = Math.min(1, loaded / total);
            const stepped = Math.floor(pct * 20);
            if (stepped === lastPct) return;
            lastPct = stepped;
            setMessages((prev) => ({
              ...prev,
              [convId]: (prev[convId] ?? []).map((m) =>
                m.id === clientMsgId || m.clientMsgId === clientMsgId
                  ? { ...m, uploadProgress: pct }
                  : m
              ),
            }));
          },
          controller.signal
        );
        if (controller.signal.aborted || cancelledUploadsRef.current.has(clientMsgId)) {
          uploadControllersRef.current.delete(clientMsgId);
          cancelledUploadsRef.current.delete(clientMsgId);
          return;
        }
        const body = await api<any>(`/v1/conversations/${convId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            type: "voice",
            body: preview,
            media_url: uploaded.url,
            client_msg_id: clientMsgId,
            reply_to_id: replyToId || undefined,
            duration_sec: Math.max(1, Math.min(60, Math.round(durationSec))),
          }),
        });
        if (cancelledUploadsRef.current.has(clientMsgId)) {
          uploadControllersRef.current.delete(clientMsgId);
          cancelledUploadsRef.current.delete(clientMsgId);
          return;
        }
        const saved = normalizeMessage(
          {
            ...body,
            conversation_id: convId,
            type: "voice",
            body: body?.body ?? preview,
            media_url: body?.media_url ?? uploaded.url,
            sender_id: meRef.current?.id,
          },
          meRef.current?.id
        );
        uploadControllersRef.current.delete(clientMsgId);
        cancelledUploadsRef.current.delete(clientMsgId);
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId || m.clientMsgId === clientMsgId
              ? {
                  ...saved,
                  mine: true,
                  pending: false,
                  failed: false,
                  uploadProgress: undefined,
                  localUri: undefined,
                  clientMsgId,
                  replyToId,
                }
              : m
          ),
        }));
      } catch (e: any) {
        uploadControllersRef.current.delete(clientMsgId);
        const cancelled =
          controller.signal.aborted ||
          cancelledUploadsRef.current.has(clientMsgId) ||
          e?.message === "upload aborted";
        cancelledUploadsRef.current.delete(clientMsgId);
        if (cancelled) {
          setMessages((prev) => ({
            ...prev,
            [convId]: (prev[convId] ?? []).filter(
              (m) => m.id !== clientMsgId && m.clientMsgId !== clientMsgId
            ),
          }));
          return;
        }
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId
              ? {
                  ...m,
                  pending: false,
                  failed: true,
                  uploadProgress: undefined,
                  error: e?.message || "Upload failed",
                }
              : m
          ),
        }));
      }
    },
    [stopTyping]
  );

  const retryMessage = useCallback(
    async (convId: string, msg: Message) => {
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).filter((m) => m.id !== msg.id),
      }));
      if ((msg.type === "image" || msg.type === "file") && msg.localUri) {
        const caption =
          msg.type === "image" && msg.content && msg.content !== "Photo" ? msg.content : undefined;
        await sendMediaMessage(convId, msg.localUri, {
          kind: msg.type === "image" ? "image" : "file",
          name: msg.localName || (msg.type === "image" ? "photo.jpg" : "file.bin"),
          mimeType: msg.localMimeType,
          replyToId: msg.replyToId,
          caption,
        });
        return;
      }
      if (msg.type === "voice" && msg.localUri) {
        const match = msg.content.match(/\((\d+)s\)/);
        const duration = match ? Number(match[1]) : 1;
        await sendVoiceMessage(convId, msg.localUri, duration, msg.replyToId);
        return;
      }
      if (msg.type === "image" && msg.mediaUrl && !msg.localUri) {
        await sendRemoteImage(convId, msg.mediaUrl, msg.content || "Photo", msg.replyToId);
        return;
      }
      await sendMessage(convId, msg.content, msg.replyToId);
    },
    [sendMessage, sendMediaMessage, sendVoiceMessage, sendRemoteImage]
  );

  const recallMessage = useCallback(async (messageId: string, convId: string) => {
    await api(`/v1/messages/${messageId}/recall`, { method: "POST" });
    const list = messagesRef.current[convId] ?? [];
    const wasLast = list.length > 0 && list[list.length - 1]?.id === messageId;
    const conv = conversations.find((c) => c.id === convId);
    const isGroup = conv?.type === "social_group" || conv?.type === "group";
    const isGroupAdmin =
      isGroup && (conv?.role === "owner" || conv?.role === "admin");
    const canSeeNotice = !isGroup || isGroupAdmin;
    setMessages((prev) => ({
      ...prev,
      [convId]: canSeeNotice
        ? (prev[convId] ?? []).map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: isGroupAdmin ? m.content : "",
                  recalled: true,
                  mediaUrl: isGroupAdmin ? m.mediaUrl : undefined,
                }
              : m
          )
        : (prev[convId] ?? []).filter((m) => m.id !== messageId),
    }));
    if (wasLast) {
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  lastMessage: canSeeNotice ? "Message recalled" : c.lastMessage,
                  lastMessageRecalled: canSeeNotice,
                }
              : c
          )
        )
      );
    }
  }, [conversations]);

  // Mirror web reactMessage (POST /v1/messages/{id}/react).
  const reactMessage = useCallback(async (messageId: string, convId: string, emoji: string) => {
    const res = await api<any>(`/v1/messages/${messageId}/react`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
    const count = Number(res?.count) || 0;
    const added = Boolean(res?.added);
    setMessages((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((m) => {
        if (m.id !== messageId) return m;
        const rest = (m.reactions ?? []).filter((x) => x.emoji !== emoji);
        const existing = (m.reactions ?? []).find((x) => x.emoji === emoji);
        const myId = meRef.current?.id ?? "";
        let users = (existing?.users ?? []).filter((u) => u.id !== myId);
        if (added) {
          users = [
            ...users,
            {
              id: myId,
              name: meRef.current?.nickname || meRef.current?.username || "",
              avatarUrl: meRef.current?.avatarUrl,
            },
          ];
        }
        return {
          ...m,
          reactions: count > 0 ? [...rest, { emoji, count, mine: added, users }] : rest,
        };
      }),
    }));
  }, []);

  // Mirror web pinMessage. Multiple pins per conversation; pinning adds, unpinning removes.
  const pinMessage = useCallback(async (messageId: string, convId: string, pin: boolean) => {
    const res = await api<any>(`/v1/messages/${messageId}/${pin ? "pin" : "unpin"}`, {
      method: "POST",
    });
    const msg = (messagesRef.current[convId] ?? []).find((m) => m.id === messageId);
    const preview =
      String(res?.body ?? "").trim() ||
      msg?.content ||
      (msg?.type === "image"
        ? "Photo"
        : msg?.type === "voice"
          ? "Voice message"
          : msg?.type === "file"
            ? "File"
            : "Pinned message");
    const fromApi = Array.isArray(res?.pinned_messages)
      ? res.pinned_messages
          .map((p: any) => ({
            id: String(p?.id ?? ""),
            body: String(p?.body ?? "").trim() || "Pinned message",
            type: p?.type ? String(p.type) : undefined,
            seq: typeof p?.seq === "number" ? p.seq : undefined,
          }))
          .filter((p: { id: string }) => p.id)
          .sort((a: { seq?: number }, b: { seq?: number }) => (a.seq ?? 0) - (b.seq ?? 0))
      : null;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        let pinnedMessages = c.pinnedMessages ?? [];
        if (fromApi) {
          pinnedMessages = fromApi;
        } else if (pin) {
          const rest = pinnedMessages.filter((p) => p.id !== messageId);
          pinnedMessages = [...rest, { id: messageId, body: preview, type: msg?.type, seq: msg?.seq }].sort(
            (a, b) => (a.seq ?? 0) - (b.seq ?? 0)
          );
        } else {
          pinnedMessages = pinnedMessages.filter((p) => p.id !== messageId);
        }
        const last = pinnedMessages[pinnedMessages.length - 1];
        return {
          ...c,
          pinnedMessages,
          pinnedMessageId: last?.id,
          pinnedMessage: last?.body,
        };
      })
    );
  }, []);

  // Mirror web editMessage (PATCH /v1/messages/{id}).
  const editMessage = useCallback(async (messageId: string, convId: string, body: string) => {
    const res = await api<any>(`/v1/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    const editedAt = String(res?.edited_at ?? new Date().toISOString());
    setMessages((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((m) =>
        m.id === messageId ? { ...m, content: body, editedAt } : m
      ),
    }));
  }, []);

  const updateConversationPrefs = useCallback(
    async (convId: string, prefs: { favorite?: boolean; muted?: boolean }) => {
      const res = await api<any>(`/v1/conversations/${convId}/prefs`, {
        method: "PATCH",
        body: JSON.stringify(prefs),
      });
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  favorite: res?.favorite != null ? Boolean(res.favorite) : c.favorite,
                  muted: res?.muted != null ? Boolean(res.muted) : c.muted,
                }
              : c
          )
        )
      );
    },
    []
  );

  // Mirror web forwardMessage (POST /v1/messages/{id}/forward).
  const forwardMessage = useCallback(
    async (messageId: string, conversationIds: string[]) => {
      await api(`/v1/messages/${messageId}/forward`, {
        method: "POST",
        body: JSON.stringify({ conversation_ids: conversationIds }),
      });
      await loadConversations();
    },
    [loadConversations]
  );

  const markConversationRead = useCallback(async (convId: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0, mentionCount: 0 } : c))
    );
    const list = messagesRef.current[convId] ?? [];
    const lastPeer = [...list].reverse().find((m) => !m.mine && !m.recalled);
    if (lastPeer?.id) {
      await api(`/v1/messages/${lastPeer.id}/read`, { method: "POST" }).catch(() => {});
    }
  }, []);
  markConversationReadRef.current = markConversationRead;

  const markUnread = useCallback(async (convId: string) => {
    const res = await api<any>(`/v1/conversations/${convId}/unread`, { method: "POST" });
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              unreadCount:
                typeof res?.unread_count === "number"
                  ? res.unread_count
                  : Math.max(1, c.unreadCount || 1),
            }
          : c
      )
    );
  }, []);

  const clearHistory = useCallback(async (convId: string) => {
    await api(`/v1/conversations/${convId}/clear`, { method: "POST" });
    setMessages((prev) => ({ ...prev, [convId]: [] }));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastMessage: undefined,
              lastMessageAt: undefined,
              unreadCount: 0,
              mentionCount: 0,
              lastMessageRecalled: false,
            }
          : c
      )
    );
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    await api(`/v1/conversations/${conversationId}`, { method: "DELETE" });
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    setActiveId((cur) => (cur === conversationId ? null : cur));
    setMessages((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const blockUser = useCallback(async (friendshipOrPeerId: string) => {
    await api(`/v1/friends/${friendshipOrPeerId}/block`, { method: "POST" });
    setConversations((prev) => {
      const next = prev.filter(
        (c) =>
          c.type !== "dm" ||
          (c.friendshipId !== friendshipOrPeerId && c.peerId !== friendshipOrPeerId)
      );
      const removed = prev.filter((c) => !next.some((n) => n.id === c.id));
      if (removed.length) {
        setActiveId((cur) => (removed.some((c) => c.id === cur) ? null : cur));
        setMessages((msgs) => {
          const copy = { ...msgs };
          for (const c of removed) delete copy[c.id];
          return copy;
        });
      }
      return next;
    });
    await loadFriends();
    await loadConversations();
  }, [loadFriends, loadConversations]);

  const unblockUser = useCallback(async (friendshipOrPeerId: string) => {
    await api(`/v1/friends/${friendshipOrPeerId}/unblock`, { method: "POST" });
    await loadFriends();
  }, [loadFriends]);

  const leaveGroup = useCallback(async (conversationId: string) => {
    await api(`/v1/groups/${conversationId}/leave`, { method: "POST" });
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    setActiveId((cur) => (cur === conversationId ? null : cur));
    setMessages((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const openDM = useCallback(
    async (userId: string) => {
      const res = await api<any>("/v1/conversations/dm", {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
      const id = String(res?.id ?? "");
      if (!id) throw new Error("failed to open DM");
      await loadConversations();
      openConversation(id);
      return id;
    },
    [loadConversations, openConversation]
  );

  const subscribeEvents = useCallback((handler: (type: string, payload: any) => void) => {
    eventListenersRef.current.add(handler);
    return () => {
      eventListenersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo(
    () => ({
      conversations,
      messages,
      hasMoreByConv,
      connected,
      loadError,
      typingByConv,
      presenceByUser,
      friends,
      loadConversations,
      loadMessages,
      loadOlderMessages,
      loadFriends,
      openConversation,
      closeConversation,
      activeId,
      sendMessage,
      sendMediaMessage,
      sendRemoteImage,
      sendVoiceMessage,
      retryMessage,
      cancelUpload,
      notifyTyping,
      stopTyping,
      openDM,
      recallMessage,
      reactMessage,
      pinMessage,
      editMessage,
      updateConversationPrefs,
      markConversationRead,
      markUnread,
      clearHistory,
      deleteConversation,
      forwardMessage,
      leaveGroup,
      blockUser,
      unblockUser,
      subscribeEvents,
    }),
    [
      conversations,
      messages,
      hasMoreByConv,
      connected,
      loadError,
      typingByConv,
      presenceByUser,
      friends,
      loadConversations,
      loadMessages,
      loadOlderMessages,
      loadFriends,
      openConversation,
      closeConversation,
      activeId,
      sendMessage,
      sendMediaMessage,
      sendRemoteImage,
      sendVoiceMessage,
      retryMessage,
      cancelUpload,
      notifyTyping,
      stopTyping,
      openDM,
      recallMessage,
      reactMessage,
      pinMessage,
      editMessage,
      updateConversationPrefs,
      markConversationRead,
      markUnread,
      clearHistory,
      deleteConversation,
      forwardMessage,
      leaveGroup,
      blockUser,
      unblockUser,
      subscribeEvents,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat outside ChatProvider");
  return ctx;
}
