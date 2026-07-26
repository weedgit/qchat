"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
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
        body: JSON.stringify({ user_id: u.id, greeting: t("chat.greetingHi") }),
      });
      const status = String(res?.status ?? "");
      setResults([]);
      setQuery("");
      await load();
      if (status === "accepted") {
        setAddMsg(t("contacts.friendAdded"));
        const convID = String(res?.conversation_id ?? "");
        if (convID) {
          router.push(`/?c=${encodeURIComponent(convID)}`);
        }
      } else {
        setAddMsg(t("contacts.requestSent"));
      }
    } catch (e: any) {
      setAddMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: Friend) {
    setBusy(true);
    setAddMsg(null);
    try {
      const res = await api<any>(`/v1/friends/${f.friendshipId}/accept`, { method: "POST" });
      await load();
      setAddMsg(t("contacts.friendAdded"));
      const convID = String(res?.conversation_id ?? "");
      if (convID) {
        router.push(`/?c=${encodeURIComponent(convID)}`);
      }
    } catch (e: any) {
      setAddMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject(f: Friend) {
    setBusy(true);
    setAddMsg(null);
    try {
      await api(`/v1/friends/${f.friendshipId}/reject`, { method: "POST" });
      await load();
    } catch (e: any) {
      setAddMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function unblock(f: Friend) {
    setBusy(true);
    setAddMsg(null);
    try {
      await api(`/v1/friends/${f.friendshipId}/unblock`, { method: "POST" });
      load();
    } catch (e: any) {
      setAddMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const incoming = friends.filter((f) => f.status === "pending" && f.incoming);
  const blocked = friends.filter((f) => f.status === "blocked");

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

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("contacts.incoming")}</div>
        {!loadError && incoming.length === 0 && (
          <div className="menu-modal-empty">{t("contacts.noIncoming")}</div>
        )}
        {incoming.map((f) => (
          <div className="menu-modal-list-row" key={f.friendshipId}>
            <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
            <div className="menu-modal-list-main">
              <div className="menu-modal-list-title">{f.nickname}</div>
              <div className="menu-modal-list-sub">@{f.username}</div>
            </div>
            <div className="menu-modal-list-actions">
              <button className="btn-ghost" disabled={busy} onClick={() => accept(f)}>
                {t("contacts.accept")}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => reject(f)}>
                {t("contacts.reject")}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("contacts.blockUsers")}</div>
        {!loadError && blocked.length === 0 && (
          <div className="menu-modal-empty">{t("contacts.noBlocked")}</div>
        )}
        {blocked.map((f) => (
          <div className="menu-modal-list-row" key={f.friendshipId}>
            <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
            <div className="menu-modal-list-main">
              <div className="menu-modal-list-title">{f.nickname}</div>
              <div className="menu-modal-list-sub">@{f.username}</div>
            </div>
            <div className="menu-modal-list-actions">
              <button className="btn-ghost" disabled={busy} onClick={() => unblock(f)}>
                {t("contacts.unblock")}
              </button>
            </div>
          </div>
        ))}
      </section>
    </MenuModal>
  );
}
