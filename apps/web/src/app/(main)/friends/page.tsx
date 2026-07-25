"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import FriendNoteEditor from "@/components/FriendNoteEditor";
import MenuModal from "@/components/MenuModal";
import { api, asList } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { Friend, normalizeFriend } from "@/lib/types";

interface LookupUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  friend_privacy?: string;
}

export default function FriendsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LookupUser[]>([]);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<any>("/v1/friends");
      setFriends(asList(body, "friends").map(normalizeFriend));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAddMsg(null);
    try {
      const body = await api<any>(`/v1/users/lookup?q=${encodeURIComponent(query.trim())}`);
      setResults(asList(body, "users"));
      if (asList(body, "users").length === 0) setAddMsg(t("chat.noResults"));
    } catch (err: any) {
      setAddMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestUser(u: LookupUser) {
    setBusy(true);
    setAddMsg(null);
    try {
      const res = await api<any>("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ user_id: u.id, message: "Hi!" }),
      });
      setAddMsg(
        res?.status === "accepted" ? t("contacts.friendAdded") : t("contacts.requestSent")
      );
      setResults([]);
      setQuery("");
      load();
    } catch (e: any) {
      setAddMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: Friend) {
    await api(`/v1/friends/${f.friendshipId}/accept`, { method: "POST" });
    load();
  }

  async function reject(f: Friend) {
    await api(`/v1/friends/${f.friendshipId}/reject`, { method: "POST" });
    load();
  }

  async function block(f: Friend) {
    await api(`/v1/friends/${f.friendshipId}/block`, { method: "POST" });
    load();
  }

  async function unblock(f: Friend) {
    await api(`/v1/friends/${f.friendshipId}/unblock`, { method: "POST" });
    load();
  }

  async function message(f: Friend) {
    setBusy(true);
    try {
      const res = await api<any>("/v1/conversations/dm", {
        method: "POST",
        body: JSON.stringify({ user_id: f.userId }),
      });
      const id = String(res?.id ?? "");
      if (!id) throw new Error("could not open chat");
      router.push(`/?c=${encodeURIComponent(id)}`);
    } catch (e: any) {
      setAddMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const incoming = friends.filter((f) => f.status === "pending" && f.incoming);
  const outgoing = friends.filter((f) => f.status === "pending" && f.outgoing);
  const accepted = friends.filter((f) => f.status === "accepted");
  const blocked = friends.filter((f) => f.status === "blocked");
  const editing = accepted.find((f) => f.friendshipId === editingId) ?? null;

  return (
    <MenuModal title={t("menu.contacts")} ariaLabel={t("menu.contacts")}>
      {loadError && <div className="menu-modal-error">{loadError}</div>}
      {addMsg && <div className="menu-modal-hint">{addMsg}</div>}

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("contacts.add")}</div>
        <form className="menu-modal-panel" onSubmit={search}>
          <div className="menu-modal-search-row">
            <input
              placeholder={t("contacts.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              required
            />
            <button className="btn-ghost" disabled={busy}>
              {t("contacts.search")}
            </button>
          </div>
        </form>
        {results.map((u) => (
          <div className="menu-modal-list-row" key={u.id}>
            <Avatar name={u.display_name} url={u.avatar_url} size={42} />
            <div className="menu-modal-list-main">
              <div className="menu-modal-list-title">{u.display_name}</div>
              <div className="menu-modal-list-sub">
                @{u.username}
                {u.friend_privacy ? ` · ${u.friend_privacy}` : ""}
              </div>
            </div>
            <div className="menu-modal-list-actions">
              <button className="btn-ghost" disabled={busy} onClick={() => requestUser(u)}>
                {t("contacts.addButton")}
              </button>
            </div>
          </div>
        ))}
      </section>

      {incoming.length > 0 && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("contacts.incoming")}</div>
          {incoming.map((f) => (
            <div className="menu-modal-list-row" key={f.friendshipId}>
              <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{f.nickname}</div>
                <div className="menu-modal-list-sub">@{f.username}</div>
              </div>
              <div className="menu-modal-list-actions">
                <button className="btn-ghost" onClick={() => accept(f)}>
                  {t("contacts.accept")}
                </button>
                <button className="btn-ghost" onClick={() => reject(f)}>
                  {t("contacts.reject")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("contacts.sent")}</div>
          {outgoing.map((f) => (
            <div className="menu-modal-list-row" key={f.friendshipId}>
              <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{f.nickname}</div>
                <div className="menu-modal-list-sub">
                  {t("contacts.pending")} · @{f.username}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("menu.contacts")}</div>
        {!loadError && accepted.length === 0 && (
          <div className="menu-modal-empty">{t("contacts.empty")}</div>
        )}
        {accepted.map((f) => {
          const display = f.note || f.nickname;
          return (
            <div className="menu-modal-list-row" key={f.friendshipId}>
              <Avatar name={display} url={f.avatarUrl} size={42} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{display}</div>
                <div className="menu-modal-list-sub">
                  {f.note ? `${f.nickname} · ` : ""}@{f.username}
                </div>
                {f.tags && f.tags.length > 0 && (
                  <div className="tag-chip-row" style={{ marginTop: 4 }}>
                    {f.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {f.online && <span className="conn-dot on" title={t("contacts.online")} />}
              <div className="menu-modal-list-actions">
                <button className="btn-ghost" onClick={() => setEditingId(f.friendshipId)}>
                  {t("contacts.note")}
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => message(f)}>
                  {t("contacts.message")}
                </button>
                <button className="btn-ghost" onClick={() => block(f)}>
                  {t("contacts.block")}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {blocked.length > 0 && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("contacts.blocked")}</div>
          {blocked.map((f) => (
            <div className="menu-modal-list-row" key={f.friendshipId}>
              <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{f.nickname}</div>
                <div className="menu-modal-list-sub">@{f.username}</div>
              </div>
              <div className="menu-modal-list-actions">
                <button className="btn-ghost" onClick={() => unblock(f)}>
                  {t("contacts.unblock")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {editing && (
        <div
          className="friend-note-modal"
          role="presentation"
          onClick={() => setEditingId(null)}
        >
          <div
            className="friend-note-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={t("contacts.editNote")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="menu-modal-bar">
              <button
                type="button"
                className="icon-btn menu-modal-close"
                title={t("chat.close")}
                aria-label={t("chat.close")}
                onClick={() => setEditingId(null)}
              >
                {"\u2715"}
              </button>
              <h1>{t("contacts.editNote")}</h1>
              <div className="menu-modal-action-slot">
                <button
                  type="button"
                  className="menu-modal-action"
                  onClick={() => {
                    const form = document.getElementById(
                      "friend-note-form"
                    ) as HTMLFormElement | null;
                    form?.requestSubmit();
                  }}
                >
                  {t("common.save")}
                </button>
              </div>
            </header>
            <div className="friend-note-modal-body">
              <div className="menu-modal-hero">
                <Avatar
                  name={editing.note || editing.nickname}
                  url={editing.avatarUrl}
                  size={96}
                />
                <div className="menu-modal-hero-name">{editing.nickname}</div>
                <div className="menu-modal-hero-sub">@{editing.username}</div>
              </div>
              <section className="menu-modal-section">
                <FriendNoteEditor
                  friendshipId={editing.friendshipId}
                  note={editing.note ?? ""}
                  tags={editing.tags ?? []}
                  startOpen
                  layout="sheet"
                  hideActions
                  formId="friend-note-form"
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    load();
                  }}
                />
              </section>
            </div>
          </div>
        </div>
      )}
    </MenuModal>
  );
}
