"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { api, clearToken } from "@/lib/api";
import { useChat } from "@/lib/useChat";
import { Conversation, Message } from "@/lib/types";

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
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`conv-item ${active ? "active" : ""}`} onClick={onClick}>
      <Avatar name={conv.title} url={conv.avatarUrl} size={50} />
      <div className="conv-body">
        <div className="conv-top">
          <span className="conv-title">{conv.title}</span>
          <span className="conv-time">{fmtTime(conv.lastMessageAt)}</span>
        </div>
        <div className="conv-bottom">
          <span className="conv-preview">
            {conv.lastMessage ? (
              <>
                {(conv.lastMessageMine || conv.type !== "dm") && conv.lastMessageSender && (
                  <span className="conv-sender">
                    {conv.lastMessageMine ? "You" : conv.lastMessageSender}:{" "}
                  </span>
                )}
                {conv.lastMessage}
              </>
            ) : (
              <span className="muted">No messages yet</span>
            )}
          </span>
          {conv.unreadCount > 0 && (
            <span className="badge">
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function receiptMark(msg: Message): string {
  if (msg.pending) return " \u23F3";
  if (msg.failed) return " !";
  if (!msg.mine || msg.recalled) return "";
  if (msg.read) return " \u2713\u2713";
  if (msg.delivered) return " \u2713\u2713";
  return " \u2713";
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
  menu: "M3 6h18 M3 12h18 M3 18h18",
  pencil: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 11a7 7 0 0 1-14 0 M12 18v4",
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

function Bubble({
  msg,
  isGroup,
  replyPreview,
  selectMode,
  selected,
  selectable,
  onToggleSelect,
  onContextMenu,
  onReact,
  onRetry,
  ctxOpen,
}: {
  msg: Message;
  isGroup: boolean;
  replyPreview?: string;
  selectMode: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelect?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  onReact?: (emoji: string) => void;
  onRetry?: () => void;
  ctxOpen: boolean;
}) {
  const canReact = !!onReact && !selectMode && !msg.recalled && !msg.pending && !msg.failed && !ctxOpen;
  // Recommend the message's top reaction if it has one, otherwise the default quick emoji.
  const recommendedEmoji = msg.reactions?.[0]?.emoji ?? QUICK_EMOJIS[0];
  const hasReactions = !msg.recalled && (msg.reactions?.length ?? 0) > 0;
  const meta = (
    <span className="meta">
      {fmtTime(msg.createdAt)}
      {receiptMark(msg)}
      {!selectMode && msg.failed && onRetry && (
        <button type="button" className="btn-ghost" style={{ marginLeft: 6, padding: "0 4px", fontSize: 11 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  );
  return (
    <div
      className={`msg-row ${msg.mine ? "mine" : ""} ${selectMode ? "select-mode" : ""} ${
        selected ? "selected" : ""
      }`}
      onClick={selectMode && selectable ? onToggleSelect : undefined}
    >
      {selectable && selectMode && (
        <button
          type="button"
          className={`select-dot ${selected ? "on" : ""}`}
          title={selected ? "Deselect" : "Select"}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
        >
          {selected ? "\u2713" : ""}
        </button>
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
        <div className={`bubble ${msg.pending ? "pending" : ""} ${msg.failed ? "error-text" : ""} ${msg.recalled ? "muted" : ""}`}>
          {!msg.mine && isGroup && msg.senderName && (
            <div className="sender">{msg.senderName}</div>
          )}
          {replyPreview && !msg.recalled && (
            <div className="muted" style={{ fontSize: 11, marginBottom: 4, borderLeft: "2px solid #888", paddingLeft: 6 }}>
              {replyPreview}
            </div>
          )}
          {msg.content}
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
      </div>
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
  const { openConversation } = chat;
  const params = useSearchParams();
  const router = useRouter();
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const openedFromQuery = useRef<string | null>(null);

  const active = chat.conversations.find((c) => c.id === chat.activeId) ?? null;
  const activeMessages = chat.activeId ? chat.messages[chat.activeId] ?? [] : [];
  const isGroup = active?.type === "social_group" || active?.type === "group";

  const selectMode = selectedIds.size > 0;
  const selectedMessages = useMemo(
    () => activeMessages.filter((m) => selectedIds.has(m.id)),
    [activeMessages, selectedIds]
  );
  const recallableSelected = selectedMessages.filter(
    (m) => m.mine && !m.recalled && !m.pending && !m.failed
  );
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
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
    clearSelection();
  }

  async function recallSelected() {
    if (!chat.activeId) return;
    for (const m of recallableSelected) {
      await chat.recallMessage(m.id, chat.activeId);
    }
    clearSelection();
  }

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMsg = ctxMenu ? activeMessages.find((m) => m.id === ctxMenu.msgId) ?? null : null;

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
        (msg.mine && !msg.recalled && !msg.failed ? 1 : 0) + // recall
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

  async function copyOne(msg: Message) {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      /* clipboard unavailable */
    }
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

  async function logout() {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    }
    clearToken();
    router.replace("/login");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chat.conversations;
    return chat.conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [chat.conversations, query]);

  useEffect(() => {
    const c = params.get("c");
    if (c && c !== openedFromQuery.current) {
      openedFromQuery.current = c;
      openConversation(c);
    }
  }, [params, openConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeMessages.length, chat.activeId]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [chat.activeId]);

  // Auto-grow the composer to fit its content (capped by CSS max-height).
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (replyTo) draftRef.current?.focus();
  }, [replyTo]);

  async function send() {
    const text = draft.trim();
    if (!text || !chat.activeId) return;
    setDraft("");
    setSendError(null);
    const replyId = replyTo?.id;
    setReplyTo(null);
    try {
      await chat.sendMessage(chat.activeId, text, replyId);
    } catch (e: any) {
      setSendError(e.message);
    }
  }

  function previewFor(msg: Message): string | undefined {
    if (!msg.replyToId) return undefined;
    const target = activeMessages.find((m) => m.id === msg.replyToId);
    return target ? `${target.senderName ?? (target.mine ? "You" : "User")}: ${target.content}` : "Reply";
  }

  return (
    <AppShell rail={false}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <button
            type="button"
            className={`icon-btn ${mainMenuOpen ? "active" : ""}`}
            title="Menu"
            onClick={(e) => {
              e.stopPropagation();
              setComposeOpen(false);
              setMainMenuOpen((v) => !v);
            }}
          >
            <MenuIcon d={ICONS.menu} />
          </button>
          <div className="search-wrap">
            <input
              className="search-input"
              placeholder={chat.connected ? "Search" : "Reconnecting\u2026"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!chat.connected && <span className="spinner" aria-label="Reconnecting" />}
          </div>
          {mainMenuOpen && (
            <div className="popup-menu main-menu" onClick={(e) => e.stopPropagation()}>
              <Link className="ctx-item" href="/profile">
                <Avatar
                  name={chat.me?.nickname || chat.me?.username || "?"}
                  url={chat.me?.avatarUrl}
                  size={22}
                />
                {chat.me?.nickname || chat.me?.username || "My profile"}
              </Link>
              <div className="ctx-sep" />
              <Link className="ctx-item" href="/friends">
                <MenuIcon d={ICONS.user} />
                Contacts
              </Link>
              <Link className="ctx-item" href="/groups">
                <MenuIcon d={ICONS.users} />
                Groups
              </Link>
              <Link className="ctx-item" href="/profile">
                <MenuIcon d={ICONS.settings} />
                Settings
              </Link>
              <div className="ctx-sep" />
              <button className="ctx-item" onClick={logout}>
                <MenuIcon d={ICONS.logout} />
                Log Out
              </button>
            </div>
          )}
        </div>
        <div className="conv-list">
          {chat.loadError && (
            <div style={{ padding: 14 }}>
              <div className="error-text">{chat.loadError}</div>
              <button className="btn-ghost" onClick={chat.reload} style={{ marginTop: 6 }}>
                Retry
              </button>
            </div>
          )}
          {!chat.loadError && filtered.length === 0 && (
            <div style={{ padding: 20 }} className="muted">
              No conversations yet. Add a friend or create a group.
            </div>
          )}
          {filtered.map((c) => (
            <ConversationRow
              key={c.id}
              conv={c}
              active={c.id === chat.activeId}
              onClick={() => chat.openConversation(c.id)}
            />
          ))}
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
            <Link className="ctx-item" href="/groups">
              <MenuIcon d={ICONS.users} />
              New Group
            </Link>
            <Link className="ctx-item" href="/friends">
              <MenuIcon d={ICONS.user} />
              New Private Chat
            </Link>
          </div>
        )}
      </aside>

      <main className="chat-pane">
        {!active ? (
          <div className="empty-state">
            <div style={{ fontSize: 44 }}>{"\u{1F4AC}"}</div>
            <div>Select a chat to start messaging</div>
          </div>
        ) : (
          <>
            {selectMode ? (
              <div className="chat-header select-bar">
                <button
                  className="btn-ghost"
                  style={{ borderRadius: 8, padding: "6px 10px" }}
                  onClick={clearSelection}
                  title="Cancel selection"
                >
                  {"\u2715"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{selectedIds.size} selected</div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ borderRadius: 8, padding: "6px 10px" }}
                  onClick={copySelected}
                >
                  Copy
                </button>
                {forwardableSelected.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ borderRadius: 8, padding: "6px 10px" }}
                    onClick={() => setForwardIds(forwardableSelected.map((m) => m.id))}
                  >
                    Forward
                  </button>
                )}
                {recallableSelected.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ borderRadius: 8, padding: "6px 10px", color: "var(--danger)" }}
                    onClick={recallSelected}
                  >
                    Recall
                  </button>
                )}
              </div>
            ) : (
              <div
                className="chat-header clickable"
                title="View details"
                onClick={() => setShowDetails(true)}
              >
                <Avatar name={active.title} url={active.avatarUrl} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{active.title}</div>
                  <div className="sub">
                    {active.type === "dm" ? "direct message" : active.type.replace("_", " ")}
                    {isGroup ? ` · ${chat.myRole}` : ""}
                  </div>
                </div>
              </div>
            )}

            <div className="msg-scroll" ref={scrollRef}>
              {activeMessages.length === 0 && (
                <div className="empty-state" style={{ minHeight: 200 }}>
                  <div className="muted">No messages here yet…</div>
                </div>
              )}
              {activeMessages.map((m) => (
                <Bubble
                  key={m.id}
                  msg={m}
                  isGroup={!!isGroup}
                  replyPreview={previewFor(m)}
                  selectMode={selectMode}
                  selected={selectedIds.has(m.id)}
                  selectable={!m.pending && !m.failed}
                  onToggleSelect={() => toggleSelect(m.id)}
                  onContextMenu={(e) => openCtxMenu(e, m)}
                  ctxOpen={!!ctxMenu}
                  onReact={
                    chat.activeId
                      ? (emoji) => chat.reactMessage(m.id, chat.activeId!, emoji).catch(() => {})
                      : undefined
                  }
                  onRetry={
                    m.failed && chat.activeId
                      ? () => chat.retryMessage(chat.activeId!, m)
                      : undefined
                  }
                />
              ))}
            </div>

            {sendError && (
              <div
                className="error-text"
                style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "0 16px" }}
              >
                Failed to send: {sendError}
              </div>
            )}

            <div className="composer">
              <div className="composer-box">
                {replyTo && (
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
                      title="Cancel reply"
                      onClick={() => setReplyTo(null)}
                    >
                      {"\u2715"}
                    </button>
                  </div>
                )}
                <div className="composer-row">
                  <textarea
                    ref={draftRef}
                    rows={1}
                    placeholder="Message"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  {draft.trim() ? (
                    <button className="send-btn" onClick={send} title="Send">
                      {"\u27A4"}
                    </button>
                  ) : (
                    <button className="send-btn" title="Record voice message">
                      <MenuIcon d={ICONS.mic} style={{ width: 20, height: 20 }} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {active && showDetails && (
        <aside className="details-panel">
          <button
            type="button"
            className="details-close"
            title="Close"
            onClick={() => setShowDetails(false)}
          >
            {"\u2715"}
          </button>
          <Avatar name={active.title} url={active.avatarUrl} size={96} />
          <div style={{ fontSize: 17, fontWeight: 700 }}>{active.title}</div>
          <div className="kv">
            <div className="k">Type</div>
            <div>{active.type}</div>
          </div>
          <div className="kv">
            <div className="k">Conversation ID</div>
            <div style={{ wordBreak: "break-all" }}>{active.id}</div>
          </div>
          <div className="kv">
            <div className="k">Last activity</div>
            <div>{active.lastMessageAt ? fmtTime(active.lastMessageAt) : "\u2014"}</div>
          </div>
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
            Copy selected
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
              Forward selected
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
            Clear selection
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
                Recall selected
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
            Select
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
                    chat.reactMessage(ctxMsg.id, chat.activeId!, em).catch(() => {});
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
                setReplyTo(ctxMsg);
                setCtxMenu(null);
              }}
            >
              <MenuIcon d={ICONS.reply} />
              Reply
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
            Copy
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
              Forward
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              toggleSelect(ctxMsg.id);
              setCtxMenu(null);
            }}
          >
            <MenuIcon d={ICONS.select} />
            Select
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
              Retry
            </button>
          )}
          {ctxMsg.mine && !ctxMsg.recalled && !ctxMsg.failed && chat.activeId && (
            <>
              <div className="ctx-sep" />
              <button
                className="ctx-item danger"
                onClick={() => {
                  chat.recallMessage(ctxMsg.id, chat.activeId!);
                  setCtxMenu(null);
                }}
              >
                <MenuIcon d={ICONS.trash} />
                Recall
              </button>
            </>
          )}
          </div>
        </div>
      )}

      {forwardIds && forwardIds.length > 0 && (
        <div className="card" style={{ position: "fixed", right: 24, bottom: 24, width: 320, zIndex: 20 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
            Forward {forwardIds.length > 1 ? `${forwardIds.length} messages` : "message"} to…
          </h3>
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {chat.conversations
              .filter((c) => c.id !== chat.activeId)
              .map((c) => (
                <div className="list-row" key={c.id}>
                  <div style={{ flex: 1 }}>{c.title}</div>
                  <button
                    className="btn"
                    style={{ flex: "none" }}
                    onClick={async () => {
                      for (const id of forwardIds) {
                        await chat.forwardMessage(id, [c.id]);
                      }
                      setForwardIds(null);
                      clearSelection();
                    }}
                  >
                    Send
                  </button>
                </div>
              ))}
          </div>
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setForwardIds(null)}>
            Cancel
          </button>
        </div>
      )}
    </AppShell>
  );
}
