import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, asList, ensureAccessToken, getToken, wsUrl } from "../lib/api";
import {
  Conversation,
  Message,
  normalizeConversation,
  normalizeMessage,
} from "../lib/types";
import { useAuth } from "./AuthContext";

type ChatContextValue = {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  connected: boolean;
  loadError: string | null;
  loadConversations: () => Promise<Conversation[]>;
  loadMessages: (convId: string) => Promise<void>;
  openConversation: (convId: string) => void;
  activeId: string | null;
  sendMessage: (convId: string, content: string) => Promise<void>;
  openDM: (userId: string) => Promise<string>;
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
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const handleIncomingRef = useRef<(raw: any) => void>(() => {});

  meRef.current = user;
  activeIdRef.current = activeId;

  const loadConversations = useCallback(async () => {
    try {
      const body = await api<any>("/v1/conversations");
      const list = asList(body, "conversations").map(normalizeConversation);
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
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  const openConversation = useCallback(
    (convId: string) => {
      setActiveId(convId);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c))
      );
      loadMessages(convId);
    },
    [loadMessages]
  );

  const handleIncoming = useCallback(
    (raw: any) => {
      const type = String(raw?.type ?? "");
      const payload = raw?.payload ?? raw?.data ?? raw;
      if (!type.includes("message")) return;

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
            [msg.conversationId]: list.map((m) =>
              m.clientMsgId && m.clientMsgId === msg.clientMsgId
                ? { ...msg, mine: true, pending: false, failed: false }
                : m.id === msg.id
                  ? { ...m, ...msg, pending: false, failed: false }
                  : m
            ),
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
        return prev.map((c) =>
          c.id === msg.conversationId
            ? {
                ...c,
                lastMessage: msg.content || c.lastMessage,
                lastMessageAt: msg.createdAt,
                lastMessageSender: msg.mine
                  ? meRef.current?.nickname || meRef.current?.username
                  : msg.senderName,
                lastMessageMine: Boolean(msg.mine),
                unreadCount:
                  c.id === activeIdRef.current || msg.mine ? c.unreadCount : c.unreadCount + 1,
              }
            : c
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

  const sendMessage = useCallback(async (convId: string, content: string) => {
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
    };
    setMessages((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] ?? []), optimistic],
    }));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastMessage: content,
              lastMessageAt: optimistic.createdAt,
              lastMessageSender: meRef.current?.nickname || meRef.current?.username,
              lastMessageMine: true,
            }
          : c
      )
    );
    try {
      const body = await api<any>(`/v1/conversations/${convId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          type: "text",
          body: content,
          client_msg_id: clientMsgId,
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
            ? { ...saved, mine: true, pending: false, failed: false, clientMsgId }
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
      openDM,
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
      openDM,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat outside ChatProvider");
  return ctx;
}
