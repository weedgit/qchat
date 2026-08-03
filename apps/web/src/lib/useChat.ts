"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatApiErrorLocale, formatSystemNotice } from "@qchat/i18n";
import { api, asList, clearToken, ensureAccessToken, formatSendError, getToken, mediaAuthURL, uploadMedia, wsUrl } from "./api";
import { useMe } from "./MeContext";
import { isQchatDesktop } from "./device";
import { loadLocalNotifyProps, shouldNotifyDesktop } from "./notifyProps";
import {
  Conversation,
  CurrentUser,
  Message,
  normalizeConversation,
  normalizeMessage,
} from "./types";
import { normalizePinnedMessages, PinnedMessage } from "./pinnedCycle";
import type { MessageKey } from "@qchat/i18n";

export type TypingUser = { userId: string; name: string };

const TYPING_TTL_MS = 3500;
const TYPING_SEND_INTERVAL_MS = 2500;

export function formatTypingLabel(
  users: TypingUser[],
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
): string {
  if (users.length === 0) return "";
  if (users.length === 1) return t("chat.typingOne", { name: users[0].name });
  if (users.length === 2) {
    return t("chat.typingTwo", { a: users[0].name, b: users[1].name });
  }
  return t("chat.typingMany");
}

export function useChat() {
  const { me, refreshMe } = useMe();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasMoreByConv, setHasMoreByConv] = useState<Record<string, boolean>>({});
  const hasMoreRef = useRef<Record<string, boolean>>({});
  const messagesListRef = useRef<Record<string, Message[]>>({});
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>("member");
  const [activeGroupMuteAll, setActiveGroupMuteAll] = useState(false);
  const [typingByConv, setTypingByConv] = useState<Record<string, TypingUser[]>>({});
 /** presence keyed by user id. */
  const [presenceByUser, setPresenceByUser] = useState<
    Record<string, { online: boolean; lastActiveAt?: string }>
  >({});

  const meRef = useRef<CurrentUser | null>(null);
  const eventListenersRef = useRef<Set<(type: string, payload: any) => void>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  /** Mattermost-style: OS/window focus (desktop IPC or browser focus+visibility). */
  const windowFocusedRef = useRef(
    typeof document !== "undefined" ? !document.hidden && document.hasFocus() : true
  );
  /** Other-member count for the active group (excludes self); seeds live receipt UI. */
  const activeGroupMemberCountRef = useRef(0);
  /** Stable latest markConversationRead for focus/visibility handlers. */
  const markConversationReadRef = useRef<(convId: string) => Promise<void>>(async () => {});
  /** True only when the shell is focused and the page is visible — required to mark read. */
  const isShellFocused = () => {
    if (typeof document !== "undefined" && document.hidden) return false;
    return windowFocusedRef.current;
  };
  /** Refresh focus from Electron (or document) before read vs notify decisions. */
  const refreshShellFocus = async (): Promise<boolean> => {
    if (typeof document !== "undefined" && document.hidden) {
      windowFocusedRef.current = false;
      return false;
    }
    if (isQchatDesktop() && window.qchatDesktop?.isWindowFocused) {
      try {
        const s = await window.qchatDesktop.isWindowFocused();
        if (s && typeof s.focused === "boolean") {
          windowFocusedRef.current = s.focused;
        }
      } catch {
        /* keep last known */
      }
    } else if (typeof document !== "undefined") {
      windowFocusedRef.current = !document.hidden && document.hasFocus();
    }
    return isShellFocused();
  };
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const typingExpiryRef = useRef<Record<string, Record<string, ReturnType<typeof setTimeout>>>>({});
  const lastTypingSentRef = useRef<Record<string, number>>({});
  const typingActiveRef = useRef<Record<string, boolean>>({});
  const typingIdleRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** In-flight media/voice uploads keyed by clientMsgId — abort to cancel. */
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledUploadsRef = useRef<Set<string>>(new Set());

  meRef.current = me;
  activeIdRef.current = activeId;
  conversationsRef.current = conversations;
  messagesListRef.current = messages;
  hasMoreRef.current = hasMoreByConv;

  useEffect(() => {
    if (!isQchatDesktop()) return;
    const desk = window.qchatDesktop;
    if (!desk?.onWindowFocusChanged && !desk?.isWindowFocused) return;

    let detach: (() => void) | undefined;
    void desk.isWindowFocused?.().then((s) => {
      if (s && typeof s.focused === "boolean") {
        windowFocusedRef.current = s.focused;
      }
    });
    if (desk.onWindowFocusChanged) {
      detach = desk.onWindowFocusChanged((payload) => {
        const focused = Boolean(payload?.focused);
        windowFocusedRef.current = focused;
        if (focused && activeIdRef.current) {
          void markConversationReadRef.current?.(activeIdRef.current);
        }
      });
    }
    return () => {
      detach?.();
    };
  }, []);

  // Browser: catch up reads when the tab becomes visible *and* focused again.
  useEffect(() => {
    if (isQchatDesktop()) return;
    const syncFocus = () => {
      windowFocusedRef.current = !document.hidden && document.hasFocus();
    };
    const onVisibility = () => {
      syncFocus();
      if (!document.hidden && document.hasFocus() && activeIdRef.current) {
        void markConversationReadRef.current?.(activeIdRef.current);
      }
    };
    const onFocus = () => {
      windowFocusedRef.current = !document.hidden;
      if (!document.hidden && activeIdRef.current) {
        void markConversationReadRef.current?.(activeIdRef.current);
      }
    };
    const onBlur = () => {
      windowFocusedRef.current = false;
    };
    syncFocus();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
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

  const loadConversations = useCallback(async () => {
    try {
      const body = await api<any>("/v1/conversations");
      // Pending join requests belong on the Groups page, not the main chat list.
      const list = asList(body, "conversations")
        .map(normalizeConversation)
        .filter((c) => (c.role || "").toLowerCase() !== "pending");
      setConversations(list);
      setPresenceByUser((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (c.type !== "dm" || !c.peerId) continue;
          next[c.peerId] = {
            online: Boolean(c.peerOnline),
            lastActiveAt: c.peerLastActiveAt,
          };
        }
        return next;
      });
      setLoadError(null);
      return list;
    } catch (e: unknown) {
      console.error("[qchat] load conversations failed:", e);
      setLoadError(formatApiErrorLocale(e, undefined, "api.err.loadFailed"));
      return [] as Conversation[];
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const body = await api<any>(`/v1/conversations/${convId}/messages?limit=50`);
      const list = asList(body, "messages")
        .map((m: any) => normalizeMessage(m, meRef.current?.id))
        .sort((a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt));
      setMessages((prev) => ({ ...prev, [convId]: list }));
      // Keep messagesListRef in sync for immediate mark-read (ref usually updates next render).
      messagesListRef.current = { ...messagesListRef.current, [convId]: list };
      const more = Boolean(body?.has_more);
      hasMoreRef.current = { ...hasMoreRef.current, [convId]: more };
      setHasMoreByConv((prev) => ({ ...prev, [convId]: more }));

      if (isShellFocused() && activeIdRef.current === convId) {
        await markConversationReadRef.current(convId);
      }
    } catch (e: unknown) {
      console.error("[qchat] load messages failed:", e);
      setLoadError(formatApiErrorLocale(e, undefined, "api.err.loadFailed"));
    }
  }, []);

  /** Mark last peer message read (mobile markConversationRead). Clears local unread. */
  const markConversationRead = useCallback(async (convId: string) => {
    if (!convId) return;
    // Never mark read while minimized / unfocused / tab hidden.
    if (!isShellFocused()) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0, mentionCount: 0 } : c))
    );
    const list = messagesListRef.current[convId] ?? [];
    const lastPeer = [...list].reverse().find((m) => !m.mine && !m.recalled && !m.pending);
    if (lastPeer?.id) {
      await api(`/v1/messages/${lastPeer.id}/read`, { method: "POST" }).catch(() => {});
    }
  }, []);
  markConversationReadRef.current = markConversationRead;

  const loadingOlderRef = useRef<Record<string, boolean>>({});
  const loadOlderMessages = useCallback(async (convId: string): Promise<number> => {
    if (loadingOlderRef.current[convId]) return 0;
    if (hasMoreRef.current[convId] === false) return 0;
    const existing = messagesListRef.current[convId] ?? [];
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
        const merged = [...older.filter((m) => !seen.has(m.id)), ...cur];
        return { ...prev, [convId]: merged };
      });
      return older.length;
    } catch (e: any) {
      console.error("[qchat] load older messages failed:", e?.message || e);
      return 0;
    } finally {
      loadingOlderRef.current[convId] = false;
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    void refreshMe();
    loadConversations();
  }, [loadConversations, refreshMe]);

  const handleIncoming = useCallback((raw: any) => {
    const type = String(raw?.type ?? "");
    const payload = raw?.payload ?? raw?.data ?? raw;

    // Same-type login / remote revoke — sign out immediately (desk/web/mobile).
    if (type === "session.revoked") {
      try {
        sessionStorage.setItem(
          "qchat.session_revoked",
          String(payload?.reason || "replaced")
        );
      } catch {
        /* ignore */
      }
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.replace("/login");
      }
      return;
    }

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
 // status_change equivalent.
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

 // patchChannel / team icon update → refresh list row.
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
      const addedRaw = payload?.added_member_ids;
      const meId = meRef.current?.id;
      if (meId && Array.isArray(addedRaw) && addedRaw.map(String).includes(meId)) {
        void loadConversations();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("qchat:conversations-changed"));
        }
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("qchat:group-updated", {
            detail: {
              conversation_id: convId,
              forbid_member_friend_add:
                payload?.forbid_member_friend_add != null
                  ? Boolean(payload.forbid_member_friend_add)
                  : undefined,
              announcement:
                payload?.announcement != null ? String(payload.announcement) : undefined,
              title: payload?.title != null ? String(payload.title) : undefined,
            },
          })
        );
      }
      eventListenersRef.current.forEach((fn) => {
        try {
          fn(type, payload);
        } catch {
          /* ignore listener errors */
        }
      });
      return;
    }

    // Join request / pending resolve — fan out to manage UIs (groups overlay).
    if (type === "group.join_request" || type === "group.pending_changed") {
      const convId = String(payload?.conversation_id ?? "");
      if (convId && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("qchat:group-pending", {
            detail: {
              conversation_id: convId,
              user_id: String(payload?.user_id ?? ""),
              action: String(payload?.action ?? (type === "group.join_request" ? "requested" : "")),
            },
          })
        );
      }
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
      const conv = conversationsRef.current.find((c) => c.id === convId);
      const isGroup = conv?.type === "social_group" || conv?.type === "group";
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
          const treatAsGroup =
            isGroup ||
            Array.isArray(m.readBy) ||
            Array.isArray(m.unreadBy) ||
            (m.memberCount != null && m.memberCount > 0);
          const memberCount =
            m.memberCount ??
            (treatAsGroup
              ? Math.max(readBy.length + unreadBy.length, activeGroupMemberCountRef.current, 0)
              : 0);
          const readCount = readBy.length;
          const allRead = memberCount > 0 && readCount >= memberCount;
          if (treatAsGroup) {
            return {
              ...m,
              delivered: true,
              read: allRead,
              readBy,
              unreadBy,
              readCount,
              memberCount: memberCount > 0 ? memberCount : m.memberCount,
            };
          }
          return {
            ...m,
            delivered: true,
            read: true,
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
    if (type === "message.pinned") {
      const convId = String(payload?.conversation_id ?? "");
      const messageId = String(payload?.message_id ?? "");
      const body = String(payload?.body ?? "").trim() || "Pinned message";
      if (!convId || !messageId) return;
      const pins = normalizePinnedMessages(payload?.pinned_messages);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const pinnedMessages =
            pins.length > 0
              ? pins
              : (() => {
                  const rest = (c.pinnedMessages ?? []).filter((p) => p.id !== messageId);
                  const next = [...rest, { id: messageId, body, type: String(payload?.type ?? ""), seq: Number(payload?.seq) || undefined }];
                  return next.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
                })();
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
    if (type === "message.unpinned") {
      const convId = String(payload?.conversation_id ?? "");
      const messageId = String(payload?.message_id ?? "");
      if (!convId) return;
      const pins = normalizePinnedMessages(payload?.pinned_messages);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const pinnedMessages =
            pins.length || payload?.pinned_messages
              ? pins
              : (c.pinnedMessages ?? []).filter((p) => p.id !== messageId);
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

    if (
      type === "friend.request" ||
      type === "friend.updated" ||
      type === "friend.accepted" ||
      type === "friend.blocked"
    ) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("qchat:friend-request", {
            detail: {
              from: String(payload?.from ?? ""),
              status: String(payload?.status ?? ""),
              id: String(payload?.id ?? ""),
              peer_id: String(payload?.peer_id ?? "") || undefined,
              conversation_id: String(payload?.conversation_id ?? "") || undefined,
              from_name: String(payload?.from_name ?? "") || undefined,
              from_username: String(payload?.from_username ?? "") || undefined,
              type,
            },
          })
        );
      }
      // Accepted requests create a DM — refresh conversation list.
      if (String(payload?.status ?? "") === "accepted" || type === "friend.accepted") {
        void loadConversations();
      }
      if (type === "friend.blocked" || String(payload?.status ?? "") === "blocked") {
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
      eventListenersRef.current.forEach((fn) => {
        try {
          fn(type, payload);
        } catch {
          /* ignore listener errors */
        }
      });
      return;
    }

    if (!type.includes("message")) return;

    const msg = normalizeMessage(payload, meRef.current?.id);
    if (!msg.conversationId) return;
    if (!msg.content && !msg.mediaUrl && !msg.clientMsgId) return;
    const isSystem = msg.type === "system";

    if (msg.senderId) clearTypingUser(msg.conversationId, msg.senderId);

    setMessages((prev) => {
      const list = prev[msg.conversationId] ?? [];
      if (list.some((m) => m.id === msg.id || (msg.clientMsgId && m.clientMsgId === msg.clientMsgId))) {
        return {
          ...prev,
          [msg.conversationId]: list.map((m) => {
            if (m.clientMsgId && m.clientMsgId === msg.clientMsgId) {
              return {
                ...msg,
                mine: true,
                pending: false,
                failed: false,
                // WS echo may omit fields the optimistic/HTTP path already set.
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

    // Read receipts and notifications must stay independent:
    // delivered = device received (may toast); read = user is actively viewing this chat.
    void (async () => {
      const shellFocused = await refreshShellFocus();
      const viewingHere =
        shellFocused && activeIdRef.current === msg.conversationId;

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
                lastMessage: isSystem
                  ? formatSystemNotice(msg.content)
                  : msg.content || c.lastMessage,
                lastMessageAt: msg.createdAt,
                lastMessageSender: msg.mine
                  ? meRef.current?.nickname || meRef.current?.username
                  : msg.senderName,
                lastMessageMine: Boolean(msg.mine),
                unreadCount:
                  viewingHere || msg.mine || isSystem ? c.unreadCount : c.unreadCount + 1,
                mentionCount:
                  viewingHere || msg.mine || isSystem
                    ? c.mentionCount ?? 0
                    : (() => {
                        const isMention =
                          Boolean((payload as any)?.mention_all) ||
                          (Array.isArray((payload as any)?.mentions) &&
                            (payload as any).mentions.includes(meRef.current?.id));
                        return (c.mentionCount ?? 0) + (isMention ? 1 : 0);
                      })(),
              }
            : c
        );
      });

      if (isSystem || msg.mine || !msg.id) return;

      // Delivered only means the client got the event — never implies read.
      api(`/v1/messages/${msg.id}/delivered`, { method: "POST" }).catch(() => {});

      if (viewingHere) {
        // Actively viewing this chat: mark read, never toast.
        api(`/v1/messages/${msg.id}/read`, { method: "POST" }).catch(() => {});
        return;
      }

      // Not viewing: notify only — do not call /read.
      const conversation = conversationsRef.current.find(
        (c) => c.id === msg.conversationId
      );
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
        return;
      }

      const sender = msg.senderName || conversation?.title || "New message";
      const target =
        conversation?.type === "dm"
          ? meRef.current?.nickname ?? ""
          : conversation?.title ?? "";
      let title = target ? `${sender} → ${target}` : sender;
      if (isMention) {
        title = Boolean((payload as any)?.mention_all)
          ? `Mentioned everyone · ${title}`
          : `Mentioned you · ${title}`;
      }
      const body = msg.content || (msg.mediaUrl ? "Attachment" : "New message");

      if (isQchatDesktop() && window.qchatDesktop?.notifyMessage) {
        window.qchatDesktop
          .notifyMessage({
            title,
            body,
            conversationId: msg.conversationId,
            silent: !notify.sound,
            mention: isMention,
            suppressIfFocused: false,
          })
          .catch((err) => {
            console.error("[qchat] desktop notifyMessage failed:", err);
          });
        return;
      }

      if ("Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(title, {
          body: msg.content,
          tag: `qchat-${msg.conversationId}`,
          silent: !notify.sound,
          icon: mediaAuthURL(msg.senderAvatar),
        });
        notification.onclick = () => {
          // Clicking a toast means the user is opening the chat — enable read after focus.
          windowFocusedRef.current = true;
          window.focus();
          setActiveId(msg.conversationId);
          void loadMessages(msg.conversationId);
          notification.close();
        };
      }
    })();
  }, [loadConversations, loadMessages, clearTypingUser, upsertTypingUser]);

  const handleIncomingRef = useRef(handleIncoming);
  handleIncomingRef.current = handleIncoming;

  useEffect(() => {
    if (!getToken()) return;
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
 // Close any prior socket before opening a new one (WebSocketClient reconnect).
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
          handleIncomingRef.current(JSON.parse(ev.data));
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
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.onclose = null;
          ws.close();
        } catch {
          /* ignore */
        }
      }
      setConnected(false);
    };
 // Intentionally empty: keep one long-lived socket. Handlers use refs (WS pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      const prevId = activeIdRef.current;
      if (prevId && prevId !== id) stopTyping(prevId);
      setActiveId(id);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0, mentionCount: 0 } : c))
      );
      // Group role only applies to social_group; DMs must not hit /v1/groups (404).
      const conv =
        conversationsRef.current.find((c) => c.id === id) ??
        null;
      const isGroup = conv?.type === "social_group" || conv?.type === "group";
      if (isGroup || !conv) {
        try {
          const g = await api<any>(`/v1/groups/${id}`);
          setMyRole(String(g?.role ?? "member"));
          setActiveGroupMuteAll(Boolean(g?.mute_all));
          const meId = meRef.current?.id;
          const members = Array.isArray(g?.members) ? g.members : [];
          activeGroupMemberCountRef.current = members.filter(
            (m: any) =>
              String(m?.user_id ?? "") !== meId &&
              String(m?.role ?? "") !== "pending"
          ).length;
        } catch {
          setMyRole("member");
          setActiveGroupMuteAll(false);
          activeGroupMemberCountRef.current = 0;
        }
      } else {
        setMyRole("member");
        setActiveGroupMuteAll(false);
        activeGroupMemberCountRef.current = 0;
      }
      loadMessages(id);
    },
    [loadMessages, stopTyping]
  );

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const selectId = String(
        (ev as CustomEvent<{ selectId?: string }>).detail?.selectId ?? ""
      );
      void loadConversations().then(() => {
        if (selectId) void openConversation(selectId);
      });
    };
    window.addEventListener("qchat:conversations-changed", onChanged);
    return () => window.removeEventListener("qchat:conversations-changed", onChanged);
  }, [loadConversations, openConversation]);

  useEffect(() => {
    if (!isQchatDesktop()) return;
    const detach = window.qchatDesktop?.onOpenConversation((conversationId) => {
      window.focus();
      if (conversationId === "__friends__") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("qchat:open-friends"));
        }
        return;
      }
      openConversation(conversationId);
    });
    return () => {
      detach?.();
    };
  }, [openConversation]);

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

  function groupReceiptSeed(convId: string): Partial<Message> {
    const conv = conversationsRef.current.find((c) => c.id === convId);
    const isGroup = conv?.type === "social_group" || conv?.type === "group";
    if (!isGroup) return {};
    const memberCount = activeGroupMemberCountRef.current;
    return {
      memberCount: memberCount > 0 ? memberCount : undefined,
      readCount: 0,
      readBy: [],
      unreadBy: [],
      delivered: false,
      read: false,
    };
  }

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
      ...groupReceiptSeed(convId),
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
            ? {
                ...saved,
                mine: true,
                pending: false,
                failed: false,
                clientMsgId,
                replyToId,
                // Keep group receipt seeds until history reload / live updates.
                memberCount: m.memberCount ?? saved.memberCount,
                readCount: m.readCount ?? saved.readCount ?? 0,
                readBy: m.readBy ?? saved.readBy,
                unreadBy: m.unreadBy ?? saved.unreadBy,
              }
            : m
        ),
      }));
    } catch (e: any) {
      const message = formatSendError(e);
      console.error("[qchat] send message failed:", message, e);
      setMessages((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === tempId
            ? { ...m, pending: false, failed: true, error: message }
            : m
        ),
      }));
      if (/group muted/i.test(message)) {
        setActiveGroupMuteAll(true);
      }
      // Do not rethrow — callers show failure on the bubble; rethrow caused
      // unhandled Next.js overlays when send() was invoked without await.
    }
  }, [stopTyping]);

  function formatVoicePreview(durationSec: number): string {
    const s = Math.max(0, Math.round(durationSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `Voice message (${m}:${r.toString().padStart(2, "0")})`;
  }

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
    if (msg.mediaUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(msg.mediaUrl);
    }
  }, []);

  const sendRemoteImage = useCallback(
    async (
      convId: string,
      mediaUrl: string,
      caption: string,
      replyToId?: string
    ) => {
      stopTyping(convId);
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = caption.trim() || "Photo";
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
        ...groupReceiptSeed(convId),
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
            media_url: body?.media_url ?? mediaUrl,
            type: "image",
            body: body?.body ?? preview,
          },
          meRef.current?.id
        );
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.clientMsgId === clientMsgId
              ? { ...saved, mine: true, pending: false, failed: false, clientMsgId }
              : m
          ),
        }));
      } catch (e: any) {
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.clientMsgId === clientMsgId
              ? { ...m, pending: false, failed: true, error: formatSendError(e) }
              : m
          ),
        }));
        throw e;
      }
    },
    [stopTyping]
  );

  const sendMediaMessage = useCallback(
    async (convId: string, file: File, replyToId?: string, caption?: string) => {
      stopTyping(convId);
      const isImage = file.type.startsWith("image/");
      const isVideo = !isImage && file.type.startsWith("video/");
      const type = isImage ? "image" : "file";
      const uploadKind = isImage ? "image" : isVideo ? "video" : "file";
      const trimmedCaption = caption?.trim() || "";
      const preview = isImage
        ? trimmedCaption || "Photo"
        : trimmedCaption || file.name || "File";
      const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempId = clientMsgId;
      const controller = new AbortController();
      uploadControllersRef.current.set(clientMsgId, controller);
      // Lightweight preview only — full File decode freezes the tab on big photos/videos.
      let localUrl = "";
      if (isImage) {
        const { makeImagePreviewUrl } = await import("./mediaPreview");
        localUrl = await makeImagePreviewUrl(file);
      } else if (isVideo) {
        localUrl = URL.createObjectURL(file);
      }
      const optimistic: Message = {
        id: tempId,
        conversationId: convId,
        senderId: meRef.current?.id ?? "me",
        content: preview,
        type,
        mediaUrl: localUrl || undefined,
        createdAt: new Date().toISOString(),
        mine: true,
        pending: true,
        uploadProgress: 0,
        clientMsgId,
        replyToId,
        localFile: file,
        ...groupReceiptSeed(convId),
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
      // Yield so the optimistic bubble paints before XHR starts.
      await new Promise<void>((r) => setTimeout(r, 0));
      if (controller.signal.aborted || cancelledUploadsRef.current.has(clientMsgId)) {
        uploadControllersRef.current.delete(clientMsgId);
        cancelledUploadsRef.current.delete(clientMsgId);
        if (localUrl) URL.revokeObjectURL(localUrl);
        return;
      }
      try {
        let lastPct = -1;
        const uploaded = await uploadMedia(
          file,
          uploadKind,
          file.name || `upload.${isImage ? "jpg" : isVideo ? "mp4" : "bin"}`,
          (loaded, total) => {
            if (cancelledUploadsRef.current.has(clientMsgId)) return;
            const pct = Math.min(1, loaded / total);
            const stepped = Math.floor(pct * 20);
            if (stepped === lastPct) return;
            lastPct = stepped;
            setMessages((prev) => ({
              ...prev,
              [convId]: (prev[convId] ?? []).map((m) =>
                m.id === tempId || m.clientMsgId === clientMsgId
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
          if (localUrl) URL.revokeObjectURL(localUrl);
          return;
        }
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
        if (cancelledUploadsRef.current.has(clientMsgId)) {
          uploadControllersRef.current.delete(clientMsgId);
          cancelledUploadsRef.current.delete(clientMsgId);
          if (localUrl) URL.revokeObjectURL(localUrl);
          return;
        }
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
        uploadControllersRef.current.delete(clientMsgId);
        cancelledUploadsRef.current.delete(clientMsgId);
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === tempId || m.clientMsgId === clientMsgId
              ? {
                  ...saved,
                  mine: true,
                  pending: false,
                  failed: false,
                  error: undefined,
                  uploadProgress: undefined,
                  localFile: undefined,
                  clientMsgId,
                  replyToId,
                }
              : m
          ),
        }));
        if (localUrl) URL.revokeObjectURL(localUrl);
      } catch (e: any) {
        uploadControllersRef.current.delete(clientMsgId);
        const cancelled =
          controller.signal.aborted ||
          cancelledUploadsRef.current.has(clientMsgId) ||
          e?.message === "upload aborted";
        cancelledUploadsRef.current.delete(clientMsgId);
        if (cancelled) {
          if (localUrl) URL.revokeObjectURL(localUrl);
          setMessages((prev) => ({
            ...prev,
            [convId]: (prev[convId] ?? []).filter(
              (m) => m.id !== tempId && m.clientMsgId !== clientMsgId
            ),
          }));
          return;
        }
        const message = formatSendError(e, "Upload failed");
        console.error("[qchat] media upload failed:", message, e);
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  pending: false,
                  failed: true,
                  uploadProgress: undefined,
                  error: message,
                }
              : m
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
      const controller = new AbortController();
      uploadControllersRef.current.set(clientMsgId, controller);
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
        uploadProgress: 0,
        clientMsgId,
        replyToId,
        ...groupReceiptSeed(convId),
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
          blob.type.includes("wav")
            ? "wav"
            : blob.type.includes("ogg")
              ? "ogg"
              : blob.type.includes("mp4") || blob.type.includes("aac") || blob.type.includes("m4a")
                ? "m4a"
                : blob.type.includes("mpeg") || blob.type.includes("mp3")
                  ? "mp3"
                  : "webm";
        let lastPct = -1;
        const uploaded = await uploadMedia(
          blob,
          "voice",
          `voice.${ext}`,
          (loaded, total) => {
            const pct = Math.min(1, loaded / total);
            const stepped = Math.floor(pct * 20);
            if (stepped === lastPct) return;
            lastPct = stepped;
            setMessages((prev) => ({
              ...prev,
              [convId]: (prev[convId] ?? []).map((m) =>
                m.id === tempId || m.clientMsgId === clientMsgId
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
          URL.revokeObjectURL(localUrl);
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
          URL.revokeObjectURL(localUrl);
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
            m.id === tempId || m.clientMsgId === clientMsgId
              ? {
                  ...saved,
                  mine: true,
                  pending: false,
                  failed: false,
                  uploadProgress: undefined,
                  clientMsgId,
                  replyToId,
                }
              : m
          ),
        }));
        URL.revokeObjectURL(localUrl);
      } catch (e: any) {
        uploadControllersRef.current.delete(clientMsgId);
        const cancelled =
          controller.signal.aborted ||
          cancelledUploadsRef.current.has(clientMsgId) ||
          e?.message === "upload aborted";
        cancelledUploadsRef.current.delete(clientMsgId);
        if (cancelled) {
          URL.revokeObjectURL(localUrl);
          setMessages((prev) => ({
            ...prev,
            [convId]: (prev[convId] ?? []).filter(
              (m) => m.id !== tempId && m.clientMsgId !== clientMsgId
            ),
          }));
          return;
        }
        const message = formatSendError(e, "Upload failed");
        console.error("[qchat] voice upload failed:", message, e);
        setMessages((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  pending: false,
                  failed: true,
                  uploadProgress: undefined,
                  error: message,
                }
              : m
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
    if ((msg.type === "image" || msg.type === "file") && msg.localFile) {
      const caption =
        msg.type === "image" && msg.content && msg.content !== "Photo" ? msg.content : undefined;
      await sendMediaMessage(convId, msg.localFile, msg.replyToId, caption);
      return;
    }
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
  }, [sendMessage, sendMediaMessage, sendVoiceMessage, stopTyping]);

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
    const res = await api<any>(`/v1/messages/${messageId}/${pin ? "pin" : "unpin"}`, {
      method: "POST",
    });
    const msg = (messages[convId] ?? []).find((m) => m.id === messageId);
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
    const fromApi = normalizePinnedMessages(res?.pinned_messages);
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        let pinnedMessages: PinnedMessage[];
        if (fromApi.length || Array.isArray(res?.pinned_messages)) {
          pinnedMessages = fromApi;
        } else if (pin) {
          const rest = (c.pinnedMessages ?? []).filter((p) => p.id !== messageId);
          pinnedMessages = [...rest, { id: messageId, body: preview, type: msg?.type, seq: msg?.seq }];
          pinnedMessages.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        } else {
          pinnedMessages = (c.pinnedMessages ?? []).filter((p) => p.id !== messageId);
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

  const updateFriendNote = useCallback(
    (conversationId: string, note: string, tags: string[]) => {
      if (!conversationId) return;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                friendNote: note || undefined,
                friendTags: tags.length ? tags : undefined,
              }
            : c
        )
      );
    },
    []
  );

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
          ? { ...c, lastMessage: undefined, lastMessageAt: undefined, unreadCount: 0 }
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

  const blockUser = useCallback(async (friendshipOrPeerId: string) => {
    await api(`/v1/friends/${friendshipOrPeerId}/block`, { method: "POST" });
    // Drop local DM rows immediately; WS friend.blocked keeps the peer in sync.
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("qchat:friend-request", {
          detail: { status: "blocked", peer_id: friendshipOrPeerId },
        })
      );
    }
    await loadConversations();
  }, [loadConversations]);

  const subscribeEvents = useCallback((handler: (type: string, payload: any) => void) => {
    eventListenersRef.current.add(handler);
    return () => {
      eventListenersRef.current.delete(handler);
    };
  }, []);

  // NOTI-03 / NOTI-04: push unread totals to Electron dock/taskbar + tray.
  // No-op in the browser; does not alter chat state.
  useEffect(() => {
    if (!isQchatDesktop()) return;
    const desk = window.qchatDesktop;
    if (!desk?.setUnreadStatus) return;
    const unread = conversations.reduce((n, c) => n + (Number(c.unreadCount) || 0), 0);
    const mentions = conversations.reduce((n, c) => n + (Number(c.mentionCount) || 0), 0);
    void desk.setUnreadStatus({ unread, mentions }).catch(() => {});
  }, [conversations]);

  useEffect(() => {
    return () => {
      if (!isQchatDesktop()) return;
      void window.qchatDesktop?.setUnreadStatus?.({ unread: 0, mentions: 0 }).catch(() => {});
    };
  }, []);

  return {
    me,
    conversations,
    activeId,
    messages,
    hasMoreByConv,
    connected,
    loadError,
    myRole,
    activeGroupMuteAll,
    setActiveGroupMuteAll,
    typingByConv,
    presenceByUser,
    notifyTyping,
    stopTyping,
    openConversation,
    openDM,
    loadOlderMessages,
    sendMessage,
    sendMediaMessage,
    sendRemoteImage,
    sendVoiceMessage,
    retryMessage,
    cancelUpload,
    recallMessage,
    forwardMessage,
    reactMessage,
    pinMessage,
    editMessage,
    updateConversationPrefs,
    updateFriendNote,
    markUnread,
    clearHistory,
    deleteConversation,
    leaveGroup,
    blockUser,
    markConversationRead,
    reload: loadConversations,
    refreshMe,
    subscribeEvents,
  };
}
