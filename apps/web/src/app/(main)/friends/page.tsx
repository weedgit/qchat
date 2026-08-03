"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatApiError } from "@qchat/i18n";
import Avatar from "@/components/Avatar";
import MenuModal from "@/components/MenuModal";
import { api, asList, ApiError } from "@/lib/api";
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
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const seededFromUrl = useRef(false);

  const load = useCallback(async () => {
    try {
      const body = await api<any>("/v1/friends");
      setFriends(asList(body, "friends").map(normalizeFriend));
      setLoadError(null);
    } catch (e: unknown) {
      setLoadError(formatApiError(e, t, "api.err.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Prefill from /friends?q=username (group member → Add contact).
  useEffect(() => {
    if (seededFromUrl.current || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q")?.trim() || "";
    if (!q) return;
    seededFromUrl.current = true;
    setQuery(q);
    window.requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);

  // Live pending/accepted updates from WS (hub publishes friend.request).
  useEffect(() => {
    const onFriend = () => {
      void load();
    };
    window.addEventListener("qchat:friend-request", onFriend);
    return () => window.removeEventListener("qchat:friend-request", onFriend);
  }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearchBusy(false);
      return;
    }
    let cancelled = false;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      api<any>(`/v1/users/lookup?q=${encodeURIComponent(q)}`)
        .then((body) => {
          if (cancelled) return;
          const users = asList(body, "users") as LookupUser[];
          setResults(users);
          setAddMsg(users.length === 0 ? t("chat.noResults") : null);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setResults([]);
          setAddMsg(err?.message || t("chat.noResults"));
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, t]);

  async function requestUser(u: LookupUser) {
    setBusy(true);
    setAddMsg(null);
    try {
      const res = await api<any>("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({
          user_id: u.id,
          username: u.username,
          greeting: t("chat.greetingHi"),
        }),
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
      if (
        e instanceof ApiError &&
        e.code === "group_forbid_friend" &&
        e.fields?.group &&
        e.fields?.owner
      ) {
        setAddMsg(
          t("contacts.groupForbidFriend", {
            group: e.fields.group,
            owner: e.fields.owner,
          })
        );
      } else {
        setAddMsg(formatApiError(e, t));
      }
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
    } catch (e: unknown) {
      setAddMsg(formatApiError(e, t));
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
    } catch (e: unknown) {
      setAddMsg(formatApiError(e, t));
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
    } catch (e: unknown) {
      setAddMsg(formatApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  const incoming = friends.filter((f) => f.status === "pending" && f.incoming);
  const outgoing = friends.filter((f) => f.status === "pending" && f.outgoing && !f.incoming);
  const blocked = friends.filter((f) => f.status === "blocked");

  return (
    <MenuModal
      title={t("menu.contacts")}
      ariaLabel={t("menu.contacts")}
      overlayClassName="contacts-modal"
    >
      {loadError && <div className="menu-modal-error">{loadError}</div>}
      {addMsg && <div className="menu-modal-hint">{addMsg}</div>}

      {incoming.length > 0 ? (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">
            {t("contacts.incomingCount", { n: incoming.length })}
          </div>
          {incoming.map((f) => (
            <div className="menu-modal-list-row is-pending-friend" key={f.friendshipId}>
              <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{f.nickname}</div>
                <div className="menu-modal-list-sub">@{f.username}</div>
                <div className="menu-modal-list-sub contacts-pending-tag">{t("contacts.pending")}</div>
              </div>
              <div className="menu-modal-list-actions">
                <button className="btn" disabled={busy} onClick={() => accept(f)}>
                  {t("contacts.accept")}
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => reject(f)}>
                  {t("contacts.reject")}
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {outgoing.length > 0 ? (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">
            {t("contacts.sentCount", { n: outgoing.length })}
          </div>
          {outgoing.map((f) => (
            <div className="menu-modal-list-row is-pending-friend" key={f.friendshipId}>
              <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{f.nickname}</div>
                <div className="menu-modal-list-sub">@{f.username}</div>
                <div className="menu-modal-list-sub contacts-pending-tag">
                  {t("contacts.waitingAccept")}
                </div>
              </div>
              <div className="menu-modal-list-actions">
                <button className="btn-ghost" disabled={busy} onClick={() => reject(f)}>
                  {t("contacts.cancelRequest")}
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("contacts.add")}</div>
        <div className="menu-modal-panel">
          <input
            ref={searchRef}
            type="search"
            placeholder={t("contacts.searchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAddMsg(null);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {searchBusy ? (
            <div className="menu-modal-empty">{t("details.searchingUsers")}</div>
          ) : null}
        </div>
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
