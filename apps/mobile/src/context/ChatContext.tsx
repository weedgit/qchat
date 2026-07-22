import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, asList, ensureAccessToken, getToken, uploadMedia, wsUrl } from "../lib/api";
import {
  Conversation,
  Message,
  normalizeConversation,
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

type ChatContextValue = {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  connected: boolean;
  loadError: string | null;
  loadConversations: () => Promise<Conversation[]>;
  loadMessages: (convId: string) => Promise<void>;
  openConversation: (convId: string) => void;
  activeId: string | null;
  sendMessage: (convId: string, content: string, replyToId?: string) => Promise<void>;
  sendMediaMessage: (
    convId: string,
    localUri: string,
    opts: { kind: "image" | "file"; name: string; mimeType?: string; replyToId?: string }
  ) => Promise<void>;
  sendVoiceMessage: (
    convId: string,
    localUri: string,
    durationSec: number,
    replyToId?: string
  ) => Promise<void>;
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
  forwardMessage: (messageId: string, conversationIds: string[]) => Promise<void>;
  /** Fan-out for non-chat WS events (e.g. call.*). Mirror web subscribeEvents. */
  subscribeEvents: (handler: (type: string, payload: any) => void) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { signedIn, user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const meRef = useRef(user);
  const activeIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const handleIncomingRef = useRef<(raw: any) => void>(() => {});
  const eventListenersRef = useRef(new Set<(type: string, payload: any) => void>());

  meRef.current = user;
  activeIdRef.current = activeId;
  messagesRef.current = messages;

  const loadConversations = useCallback(async () => {
    try {
      const body = await api<any>("/v1/conversations");
      const list = sortConversations(asList(body, "conversations").map(normalizeConversation));
      setConversations(list);
      setLoadError(null);
      return list;
    } catch (e: any) {
      setLoadError(e.message);
      return [] as Conversation[];
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const body = await api<any>(`/v1/conversations/${convId}/messages?limit=100`);
      const list = asList(body, "messages")
        .map((m: any) => normalizeMessage(m, meRef.current?.id))
        .sort((a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt));
      setMessages((prev) => ({ ...prev, [convId]: list }));
      const last = list[list.length - 1];
      if (last && !last.mine) {
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
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  const openConversation = useCallback(
    (convId: string) => {
      setActiveId(convId);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0, mentionCount: 0 } : c))
      );
      loadMessages(convId);
    },
    [loadMessages]
  );

  const handleIncoming = useCallback(
    (raw: any) => {
      const type = String(raw?.type ?? "");
      const payload = raw?.payload ?? raw?.data ?? raw;

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
        if (!id || !convId) return;
        const list = messagesRef.current[convId] ?? [];
        const wasLast = list.length > 0 && list[list.length - 1]?.id === id;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === id ? { ...m, content: body } : m
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
            return { ...c, title, avatarUrl };
          })
        );
        return;
      }

      if (type === "message.read") {
        const id = String(payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        const seq = Number(payload?.seq);
        if (!id || !convId) return;
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) => {
            if (m.id === id) return { ...m, read: true, delivered: true };
            if (m.mine && Number.isFinite(seq) && typeof m.seq === "number" && m.seq <= seq) {
              return { ...m, read: true, delivered: true };
            }
            return m;
          }),
        }));
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
                    : msg.content || c.lastMessage,
                  lastMessageAt: msg.createdAt,
                  lastMessageSender: msg.mine
                    ? meRef.current?.nickname || meRef.current?.username
                    : msg.senderName,
                  lastMessageMine: Boolean(msg.mine),
                  lastMessageRecalled: Boolean(msg.recalled),
                  unreadCount:
                    c.id === activeIdRef.current || msg.mine
                      ? c.unreadCount
                      : c.unreadCount + 1,
                }
              : c
          )
        );
      });

      if (!msg.mine && msg.id) {
        api(`/v1/messages/${msg.id}/delivered`, { method: "POST" }).catch(() => {});
        if (activeIdRef.current === msg.conversationId) {
          api(`/v1/messages/${msg.id}/read`, { method: "POST" }).catch(() => {});
        }
      }
    },
    [loadConversations]
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
        if (!disposed) {
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
  }, [signedIn, loadConversations]);

  const sendMessage = useCallback(async (convId: string, content: string, replyToId?: string) => {
    const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: clientMsgId,
      conversationId: convId,
      senderId: meRef.current?.id ?? "me",
      content,
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
                lastMessage: content,
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
          body: content,
          client_msg_id: clientMsgId,
          reply_to_id: replyToId || undefined,
        }),
      });
      const saved = normalizeMessage(
        {
          ...body,
          conversation_id: convId,
          body: body?.body ?? content,
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
    } catch {
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === clientMsgId ? { ...m, pending: false, failed: true } : m
        ),
      }));
    }
  }, []);

  const sendMediaMessage = useCallback(
    async (
      convId: string,
      localUri: string,
      opts: { kind: "image" | "file"; name: string; mimeType?: string; replyToId?: string }
    ) => {
      const { kind, name, mimeType, replyToId } = opts;
      const preview = kind === "image" ? "Photo" : name || "File";
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        const uploaded = await uploadMedia(
          localUri,
          kind,
          name || (kind === "image" ? "photo.jpg" : "file.bin"),
          mimeType || (kind === "image" ? "image/jpeg" : "application/octet-stream")
        );
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
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId || m.clientMsgId === clientMsgId
              ? { ...saved, mine: true, pending: false, failed: false, clientMsgId, replyToId }
              : m
          ),
        }));
      } catch {
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId ? { ...m, pending: false, failed: true } : m
          ),
        }));
      }
    },
    []
  );

  const sendVoiceMessage = useCallback(
    async (convId: string, localUri: string, durationSec: number, replyToId?: string) => {
      const preview = `Voice message (${Math.max(1, Math.round(durationSec))}s)`;
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        const uploaded = await uploadMedia(localUri, "voice", "voice.m4a", "audio/mp4");
        const body = await api<any>(`/v1/conversations/${convId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            type: "voice",
            body: preview,
            media_url: uploaded.url,
            client_msg_id: clientMsgId,
            reply_to_id: replyToId || undefined,
          }),
        });
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
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId || m.clientMsgId === clientMsgId
              ? { ...saved, mine: true, pending: false, failed: false, clientMsgId, replyToId }
              : m
          ),
        }));
      } catch {
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === clientMsgId ? { ...m, pending: false, failed: true } : m
          ),
        }));
      }
    },
    []
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
      connected,
      loadError,
      loadConversations,
      loadMessages,
      openConversation,
      activeId,
      sendMessage,
      sendMediaMessage,
      sendVoiceMessage,
      openDM,
      recallMessage,
      reactMessage,
      pinMessage,
      editMessage,
      updateConversationPrefs,
      markConversationRead,
      forwardMessage,
      subscribeEvents,
    }),
    [
      conversations,
      messages,
      connected,
      loadError,
      loadConversations,
      loadMessages,
      openConversation,
      activeId,
      sendMessage,
      sendMediaMessage,
      sendVoiceMessage,
      openDM,
      recallMessage,
      reactMessage,
      pinMessage,
      editMessage,
      updateConversationPrefs,
      markConversationRead,
      forwardMessage,
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
