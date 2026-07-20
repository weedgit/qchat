"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, asList, getToken, uploadMedia, wsUrl } from "./api";
import { isQchatDesktop } from "./device";
import { loadLocalNotifyProps, shouldNotifyDesktop } from "./notifyProps";
import {
  Conversation,
  CurrentUser,
  Message,
  normalizeConversation,
  normalizeMessage,
} from "./types";

export type TypingUser = { userId: string; name: string };

const TYPING_TTL_MS = 3500;
const TYPING_SEND_INTERVAL_MS = 2500;

export function formatTypingLabel(users: TypingUser[]): string {
  if (users.length === 0) return "";
  if (users.length === 1) return `${users[0].name} is typing…`;
  if (users.length === 2) return `${users[0].name} and ${users[1].name} are typing…`;
  return "Several people are typing…";
}

export function useChat() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>("member");
  const [typingByConv, setTypingByConv] = useState<Record<string, TypingUser[]>>({});
  /** Mattermost-style presence keyed by user id. */
  const [presenceByUser, setPresenceByUser] = useState<
    Record<string, { online: boolean; lastActiveAt?: string }>
  >({});

  const meRef = useRef<CurrentUser | null>(null);
  const eventListenersRef = useRef<Set<(type: string, payload: any) => void>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const typingExpiryRef = useRef<Record<string, Record<string, ReturnType<typeof setTimeout>>>>({});
  const lastTypingSentRef = useRef<Record<string, number>>({});
  const typingActiveRef = useRef<Record<string, boolean>>({});
  const typingIdleRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  meRef.current = me;
  activeIdRef.current = activeId;
  conversationsRef.current = conversations;

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
      setTypingByConv((prev) => {
        const list = prev[convId] ?? [];
        const idx = list.findIndex((u) => u.userId === userId);
        const nextUser = { userId, name: name || "Someone" };
        if (idx >= 0) {
          const copy = [...list];
          copy[idx] = nextUser;
          return { ...prev, [convId]: copy };
        }
        return { ...prev, [convId]: [...list, nextUser] };
      });
      if (!typingExpiryRef.current[convId]) typingExpiryRef.current[convId] = {};
      const existing = typingExpiryRef.current[convId][userId];
      if (existing) clearTimeout(existing);
      typingExpiryRef.current[convId][userId] = setTimeout(() => {
        clearTypingUser(convId, userId);
      }, TYPING_TTL_MS);
    },
    [clearTypingUser]
  );

  const wsSend = useCallback((type: string, payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch {
      /* ignore */
    }
  }, []);

  const stopTyping = useCallback(
    (convId: string) => {
      if (!convId) return;
      if (typingIdleRef.current[convId]) {
        clearTimeout(typingIdleRef.current[convId]);
        delete typingIdleRef.current[convId];
      }
      if (!typingActiveRef.current[convId]) return;
      typingActiveRef.current[convId] = false;
      delete lastTypingSentRef.current[convId];
      wsSend("typing.stop", { conversation_id: convId });
    },
    [wsSend]
  );

  const notifyTyping = useCallback(
    (convId: string) => {
      if (!convId) return;
      const now = Date.now();
      const last = lastTypingSentRef.current[convId] ?? 0;
      typingActiveRef.current[convId] = true;
      if (now - last >= TYPING_SEND_INTERVAL_MS) {
        lastTypingSentRef.current[convId] = now;
        wsSend("typing.start", { conversation_id: convId });
      }
      if (typingIdleRef.current[convId]) clearTimeout(typingIdleRef.current[convId]);
      typingIdleRef.current[convId] = setTimeout(() => stopTyping(convId), TYPING_TTL_MS);
    },
    [wsSend, stopTyping]
  );

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    if (isQchatDesktop()) return;

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

  useEffect(() => {
    if (!me) return;
    const t = window.setTimeout(() => {
      import("./webPush")
        .then((m) => m.registerWebPush())
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [me]);

  useEffect(() => {
    if (!isQchatDesktop()) return;
    const detach = window.qchatDesktop?.onOpenConversation((conversationId) => {
      window.focus();
      openConversation(conversationId);
    });
    return () => {
      detach?.();
    };
  }, [openConversation]);

  const loadConversations = useCallback(async () => {
    try {
      const body = await api<any>("/v1/conversations");
      const list = asList(body, "conversations").map(normalizeConversation);
      setConversations(list);
      setPresenceByUser((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (!c.peerId) continue;
          next[c.peerId] = {
            online: Boolean(c.peerOnline),
            lastActiveAt: c.peerLastActiveAt,
          };
        }
        return next;
      });
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
    // Mattermost status_change equivalent.
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
      return;
    }
    if (type === "message.updated") {
      const id = String(payload?.id ?? "");
      const convId = String(payload?.conversation_id ?? "");
      const body = String(payload?.body ?? "");
      const editedAt = String(payload?.edited_at ?? new Date().toISOString());
      if (!id || !convId) return;
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === id ? { ...m, content: body, editedAt } : m
        ),
      }));
      return;
    }

    // Mattermost patchChannel / team icon update → refresh list row.
    if (type === "group.updated") {
      const convId = String(payload?.conversation_id ?? "");
      if (!convId) return;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const title = payload?.title != null ? String(payload.title) : c.title;
          const avatarUrl =
            payload?.avatar_url != null ? String(payload.avatar_url) || undefined : c.avatarUrl;
          return { ...c, title, avatarUrl };
        })
      );
      return;
    }

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
      const recalledBody = String(payload?.body ?? "");
      if (!id || !convId) return;
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === id ? { ...m, content: recalledBody, recalled: true } : m
        ),
      }));
      return;
    }
    if (!type.includes("message")) return;

    const msg = normalizeMessage(payload, meRef.current?.id);
    if (!msg.conversationId) return;
    if (!msg.content && !msg.mediaUrl && !msg.clientMsgId) return;

    if (msg.senderId) clearTypingUser(msg.conversationId, msg.senderId);

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
      if (document.hidden || activeIdRef.current !== msg.conversationId) {
        const conversation = conversationsRef.current.find((c) => c.id === msg.conversationId);
        const notify = loadLocalNotifyProps();
        const isMention =
          Boolean((payload as any)?.mention_all) ||
          (Array.isArray((payload as any)?.mentions) &&
            (payload as any).mentions.includes(meRef.current?.id));
        if (
          !shouldNotifyDesktop(notify, {
            muted: conversation?.muted,
            isMention,
          })
        ) {
          /* skip per Mattermost notify_props */
        } else {
          if (isQchatDesktop() && window.qchatDesktop?.notifyMessage) {
            window.qchatDesktop.notifyMessage({
              title: msg.senderName || conversation?.title || "New message",
              body: msg.content,
              conversationId: msg.conversationId,
              silent: !notify.sound,
            }).catch(() => {});
          } else if ("Notification" in window && Notification.permission === "granted") {
            const notification = new Notification(
              msg.senderName || conversation?.title || "New message",
              {
                body: msg.content,
                tag: `qchat-${msg.conversationId}`,
                silent: !notify.sound,
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
      }
    }
  }, [loadConversations, loadMessages, clearTypingUser, upsertTypingUser]);

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
      const prevId = activeIdRef.current;
      if (prevId && prevId !== id) stopTyping(prevId);
      setActiveId(id);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
      );
      // Don't rely on the cached conversation list here: right after creating
      // a group it may not contain the new conversation yet. DMs return 404
      // from the groups endpoint and fall back to "member".
      try {
        const g = await api<any>(`/v1/groups/${id}`);
        setMyRole(String(g?.role ?? "member"));
      } catch {
        setMyRole("member");
      }
      loadMessages(id);
    },
    [loadMessages, stopTyping]
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
    stopTyping(convId);
    const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempId = clientMsgId;
    const optimistic: Message = {
      id: tempId,
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
  }, [stopTyping]);

  function formatVoicePreview(durationSec: number): string {
    const s = Math.max(0, Math.round(durationSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `Voice message (${m}:${r.toString().padStart(2, "0")})`;
  }

  const sendMediaMessage = useCallback(
    async (convId: string, file: File, replyToId?: string) => {
      stopTyping(convId);
      const isImage = file.type.startsWith("image/");
      const type = isImage ? "image" : "file";
      const preview = isImage ? "Photo" : file.name || "File";
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempId = clientMsgId;
      const localUrl = URL.createObjectURL(file);
      const optimistic: Message = {
        id: tempId,
        conversationId: convId,
        senderId: meRef.current?.id ?? "me",
        content: preview,
        type,
        mediaUrl: localUrl,
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
            ? {
                ...c,
                lastMessage: preview,
                lastMessageAt: optimistic.createdAt,
                lastMessageSender: meRef.current?.nickname || meRef.current?.username,
                lastMessageMine: true,
              }
            : c
        )
      );
      try {
        const uploaded = await uploadMedia(file, isImage ? "image" : "file", file.name || `upload.${isImage ? "jpg" : "bin"}`);
        const body = await api<any>(`/v1/conversations/${convId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            type,
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
            type,
            body: body?.body ?? preview,
            media_url: body?.media_url ?? uploaded.url,
            sender_id: meRef.current?.id,
          },
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
        URL.revokeObjectURL(localUrl);
      } catch (e: any) {
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === tempId ? { ...m, pending: false, failed: true } : m
          ),
        }));
        throw e;
      }
    },
    [stopTyping]
  );

  const sendVoiceMessage = useCallback(
    async (convId: string, blob: Blob, durationSec: number, replyToId?: string) => {
      stopTyping(convId);
      const preview = formatVoicePreview(durationSec);
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempId = clientMsgId;
      const localUrl = URL.createObjectURL(blob);
      const optimistic: Message = {
        id: tempId,
        conversationId: convId,
        senderId: meRef.current?.id ?? "me",
        content: preview,
        type: "voice",
        mediaUrl: localUrl,
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
            ? {
                ...c,
                lastMessage: preview,
                lastMessageAt: optimistic.createdAt,
                lastMessageSender: meRef.current?.nickname || meRef.current?.username,
                lastMessageMine: true,
              }
            : c
        )
      );

      try {
        const ext =
          blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
        const uploaded = await uploadMedia(blob, "voice", `voice.${ext}`);
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
            m.id === tempId || m.clientMsgId === clientMsgId
              ? { ...saved, mine: true, pending: false, failed: false, clientMsgId, replyToId }
              : m
          ),
        }));
        URL.revokeObjectURL(localUrl);
      } catch (e: any) {
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === tempId ? { ...m, pending: false, failed: true } : m
          ),
        }));
        throw e;
      }
    },
    [stopTyping]
  );

  const retryMessage = useCallback(async (convId: string, msg: Message) => {
    setMessages((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).filter((m) => m.id !== msg.id),
    }));
    if (msg.type === "voice" && msg.mediaUrl) {
      // Re-upload only works for blob URLs; otherwise resend existing media_url.
      if (msg.mediaUrl.startsWith("blob:")) {
        const res = await fetch(msg.mediaUrl);
        const blob = await res.blob();
        const match = msg.content.match(/\((\d+):(\d+)\)/);
        const duration = match ? Number(match[1]) * 60 + Number(match[2]) : 1;
        await sendVoiceMessage(convId, blob, duration, msg.replyToId);
        return;
      }
      stopTyping(convId);
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const body = await api<any>(`/v1/conversations/${convId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          type: "voice",
          body: msg.content || "Voice message",
          media_url: msg.mediaUrl,
          client_msg_id: clientMsgId,
          reply_to_id: msg.replyToId || undefined,
        }),
      });
      const saved = normalizeMessage(
        { ...body, conversation_id: convId, sender_id: meRef.current?.id },
        meRef.current?.id
      );
      setMessages((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), { ...saved, mine: true }],
      }));
      return;
    }
    await sendMessage(convId, msg.content, msg.replyToId);
  }, [sendMessage, sendVoiceMessage, stopTyping]);

  const recallMessage = useCallback(async (messageId: string, convId: string) => {
    await api(`/v1/messages/${messageId}/recall`, { method: "POST" });
    const conv = conversations.find((c) => c.id === convId);
    const isGroup = conv?.type === "social_group" || conv?.type === "group";
    const isGroupAdmin = isGroup && (myRole === "owner" || myRole === "admin");
    const canSeeNotice = !isGroup || isGroupAdmin;
    setMessages((prev) => ({
      ...prev,
      [convId]: canSeeNotice
        ? (prev[convId] ?? []).map((m) =>
            m.id === messageId
              ? { ...m, content: isGroupAdmin ? m.content : "", recalled: true }
              : m
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

  const pinMessage = useCallback(async (messageId: string, convId: string, pin: boolean) => {
    await api(`/v1/messages/${messageId}/${pin ? "pin" : "unpin"}`, { method: "POST" });
    const msg = (messages[convId] ?? []).find((m) => m.id === messageId);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              pinnedMessageId: pin ? messageId : undefined,
              pinnedMessage: pin ? msg?.content : undefined,
            }
          : c
      )
    );
  }, [messages]);

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

  const forwardMessage = useCallback(async (messageId: string, conversationIds: string[]) => {
    await api(`/v1/messages/${messageId}/forward`, {
      method: "POST",
      body: JSON.stringify({ conversation_ids: conversationIds }),
    });
    await loadConversations();
  }, [loadConversations]);

  const updateConversationPrefs = useCallback(
    async (convId: string, prefs: { favorite?: boolean; muted?: boolean }) => {
      const res = await api<any>(`/v1/conversations/${convId}/prefs`, {
        method: "PATCH",
        body: JSON.stringify(prefs),
      });
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                favorite: res?.favorite != null ? Boolean(res.favorite) : c.favorite,
                muted: res?.muted != null ? Boolean(res.muted) : c.muted,
              }
            : c
        );
        return [...next].sort((a, b) => {
          if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
          return (b.lastMessageAt || "").localeCompare(a.lastMessageAt || "");
        });
      });
    },
    []
  );

  const markConversationUnread = useCallback(async (convId: string) => {
    const res = await api<any>(`/v1/conversations/${convId}/unread`, { method: "POST" });
    const unread = Number(res?.unread_count) || 1;
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, unreadCount: Math.max(1, unread) } : c))
    );
    if (activeIdRef.current === convId) setActiveId(null);
  }, []);

  const subscribeEvents = useCallback((handler: (type: string, payload: any) => void) => {
    eventListenersRef.current.add(handler);
    return () => {
      eventListenersRef.current.delete(handler);
    };
  }, []);

  return {
    me,
    conversations,
    activeId,
    messages,
    connected,
    loadError,
    myRole,
    typingByConv,
    presenceByUser,
    notifyTyping,
    stopTyping,
    openConversation,
    openDM,
    sendMessage,
    sendMediaMessage,
    sendVoiceMessage,
    retryMessage,
    recallMessage,
    forwardMessage,
    reactMessage,
    pinMessage,
    editMessage,
    updateConversationPrefs,
    markConversationUnread,
    reload: loadConversations,
    subscribeEvents,
  };
}
