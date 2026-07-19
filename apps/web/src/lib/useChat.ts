"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, asList, getToken, wsUrl } from "./api";
import {
  Conversation,
  CurrentUser,
  Message,
  normalizeConversation,
  normalizeMessage,
} from "./types";

export function useChat() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>("member");

  const meRef = useRef<CurrentUser | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);

  meRef.current = me;
  activeIdRef.current = activeId;
  conversationsRef.current = conversations;

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "default") return;

    const requestPermission = () => {
      Notification.requestPermission().catch(() => {});
    };
    window.addEventListener("pointerdown", requestPermission, { once: true });
    window.addEventListener("keydown", requestPermission, { once: true });
    return () => {
      window.removeEventListener("pointerdown", requestPermission);
      window.removeEventListener("keydown", requestPermission);
    };
  }, []);

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

  useEffect(() => {
    if (!getToken()) return;
    api<any>("/v1/me")
      .then((u) =>
        setMe({
          id: String(u?.id ?? ""),
          phone: String(u?.phone ?? ""),
          username: String(u?.username ?? ""),
          nickname: String(u?.display_name ?? u?.username ?? "Me"),
          avatarUrl: u?.avatar_url || undefined,
        })
      )
      .catch(() => {});
    loadConversations();
  }, [loadConversations]);

  const handleIncoming = useCallback((raw: any) => {
    const type = String(raw?.type ?? "");
    const payload = raw?.payload ?? raw?.data ?? raw;

    if (type === "message.read") {
      const id = String(payload?.id ?? "");
      const convId = String(payload?.conversation_id ?? "");
      if (!id || !convId) return;
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === id ? { ...m, read: true, delivered: true } : m
        ),
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
    if (type === "message.removed") {
      const id = String(payload?.id ?? "");
      const convId = String(payload?.conversation_id ?? "");
      if (!id || !convId) return;
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).filter((m) => m.id !== id),
      }));
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
    if (type === "message.recalled") {
      const id = String(payload?.id ?? "");
      const convId = String(payload?.conversation_id ?? "");
      if (!id || !convId) return;
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === id ? { ...m, content: "[recalled]", recalled: true } : m
        ),
      }));
      return;
    }
    if (!type.includes("message")) return;

    const msg = normalizeMessage(payload, meRef.current?.id);
    if (!msg.conversationId) return;
    if (!msg.content && !msg.clientMsgId) return;

    setMessages((prev) => {
      const list = prev[msg.conversationId] ?? [];
      if (list.some((m) => m.id === msg.id || (msg.clientMsgId && m.clientMsgId === msg.clientMsgId))) {
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
                c.id === activeIdRef.current || msg.mine
                  ? c.unreadCount
                  : c.unreadCount + 1,
            }
          : c
      );
    });

    if (!msg.mine && msg.id) {
      api(`/v1/messages/${msg.id}/delivered`, { method: "POST" }).catch(() => {});
      if (activeIdRef.current === msg.conversationId) {
        api(`/v1/messages/${msg.id}/read`, { method: "POST" }).catch(() => {});
      }
      if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        (document.hidden || activeIdRef.current !== msg.conversationId)
      ) {
        const conversation = conversationsRef.current.find((c) => c.id === msg.conversationId);
        const notification = new Notification(
          msg.senderName || conversation?.title || "New message",
          {
            body: msg.content,
            tag: `qchat-${msg.conversationId}`,
          }
        );
        notification.onclick = () => {
          window.focus();
          setActiveId(msg.conversationId);
          setConversations((prev) =>
            prev.map((c) => (c.id === msg.conversationId ? { ...c, unreadCount: 0 } : c))
          );
          loadMessages(msg.conversationId);
          notification.close();
        };
      }
    }
  }, [loadConversations, loadMessages]);

  useEffect(() => {
    if (!getToken()) return;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        backoffRef.current = 1000;
      };
      ws.onmessage = (ev) => {
        try {
          handleIncoming(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          const delay = Math.min(backoffRef.current, 15000);
          backoffRef.current = Math.min(delay * 2, 15000);
          retryRef.current = setTimeout(connect, delay);
        }
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      disposed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [handleIncoming]);

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
      );
      const conv = conversations.find((c) => c.id === id);
      if (conv?.type === "social_group" || conv?.type === "group") {
        try {
          const g = await api<any>(`/v1/groups/${id}`);
          setMyRole(String(g?.role ?? "member"));
        } catch {
          setMyRole("member");
        }
      } else {
        setMyRole("member");
      }
      loadMessages(id);
    },
    [conversations, loadMessages]
  );

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

  const sendMessage = useCallback(async (convId: string, content: string, replyToId?: string) => {
    const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempId = clientMsgId;
    const optimistic: Message = {
      id: tempId,
      conversationId: convId,
      senderId: meRef.current?.id ?? "me",
      content,
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
      prev.map((c) =>
        c.id === convId
          ? { ...c, lastMessage: content, lastMessageAt: optimistic.createdAt }
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
          reply_to_id: replyToId || undefined,
        }),
      });
      const saved = normalizeMessage(
        { ...body, conversation_id: convId, body: body?.body ?? content, sender_id: meRef.current?.id },
        meRef.current?.id
      );
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === tempId || m.clientMsgId === clientMsgId
            ? { ...saved, mine: true, pending: false, failed: false, clientMsgId, replyToId }
            : m
        ),
      }));
    } catch (e: any) {
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === tempId ? { ...m, pending: false, failed: true } : m
        ),
      }));
      throw e;
    }
  }, []);

  const retryMessage = useCallback(async (convId: string, msg: Message) => {
    setMessages((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).filter((m) => m.id !== msg.id),
    }));
    await sendMessage(convId, msg.content, msg.replyToId);
  }, [sendMessage]);

  const recallMessage = useCallback(async (messageId: string, convId: string) => {
    await api(`/v1/messages/${messageId}/recall`, { method: "POST" });
    const conv = conversations.find((c) => c.id === convId);
    const isGroup = conv?.type === "social_group" || conv?.type === "group";
    const canSeeNotice = !isGroup || myRole === "owner" || myRole === "admin";
    setMessages((prev) => ({
      ...prev,
      [convId]: canSeeNotice
        ? (prev[convId] ?? []).map((m) =>
            m.id === messageId ? { ...m, content: "[recalled]", recalled: true } : m
          )
        : (prev[convId] ?? []).filter((m) => m.id !== messageId),
    }));
  }, [conversations, myRole]);

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

  const forwardMessage = useCallback(async (messageId: string, conversationIds: string[]) => {
    await api(`/v1/messages/${messageId}/forward`, {
      method: "POST",
      body: JSON.stringify({ conversation_ids: conversationIds }),
    });
    await loadConversations();
  }, [loadConversations]);

  return {
    me,
    conversations,
    activeId,
    messages,
    connected,
    loadError,
    myRole,
    openConversation,
    openDM,
    sendMessage,
    retryMessage,
    recallMessage,
    forwardMessage,
    reactMessage,
    reload: loadConversations,
  };
}
