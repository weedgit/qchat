"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import GroupQr from "@/components/GroupQr";
import MenuModal from "@/components/MenuModal";
import { api, asList } from "@/lib/api";
import { parseGroupJoinPayload } from "@/lib/groupQr";
import { useLocale } from "@/lib/locale";
import { Conversation, Friend, normalizeConversation, normalizeFriend } from "@/lib/types";

interface PendingUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
}

interface GroupMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: string;
  mute_until?: string;
}

export default function GroupsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [groups, setGroups] = useState<Conversation[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [joinId, setJoinId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [role, setRole] = useState("");
  const [publicId, setPublicId] = useState("");
  const [muteAll, setMuteAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [convBody, friendBody] = await Promise.all([
      api<any>("/v1/conversations"),
      api<any>("/v1/friends"),
    ]);
    setGroups(
      asList(convBody, "conversations")
        .map(normalizeConversation)
        .filter((c) => c.type === "social_group" || c.type === "group")
    );
    setFriends(
      asList(friendBody, "friends")
        .map(normalizeFriend)
        .filter((f) => f.status === "accepted")
    );
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<any>("/v1/groups", {
        method: "POST",
        body: JSON.stringify({ title, member_ids: selected }),
      });
      setMsg(`Group created. ID: ${res?.public_id}`);
      setTitle("");
      setSelected([]);
      await load();
      if (res?.id) router.push(`/?c=${encodeURIComponent(res.id)}`);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const parsed = parseGroupJoinPayload(joinId) ?? joinId.trim();
      if (!parsed) {
        setMsg(t("groups.invalidJoin"));
        return;
      }
      const res = await api<any>("/v1/groups/join", {
        method: "POST",
        body: JSON.stringify({ public_id: parsed }),
      });
      setMsg(`Join request: ${res?.status ?? "submitted"}`);
      setJoinId("");
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openManage(id: string) {
    setActiveGroup(id);
    setBusy(true);
    try {
      const [details, pend] = await Promise.all([
        api<any>(`/v1/groups/${id}`),
        api<any>(`/v1/groups/${id}/pending`).catch(() => ({ pending: [] })),
      ]);
      setRole(String(details?.role ?? ""));
      setPublicId(String(details?.public_id ?? ""));
      setMuteAll(Boolean(details?.mute_all));
      setMembers(asList(details, "members"));
      setPending(asList(pend, "pending"));
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(userId: string) {
    if (!activeGroup) return;
    await api(`/v1/groups/${activeGroup}/approve`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
    openManage(activeGroup);
  }

  async function mute(userId: string, duration: string) {
    if (!activeGroup) return;
    await api(`/v1/groups/${activeGroup}/mute`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, duration }),
    });
    openManage(activeGroup);
  }

  async function appoint(userId: string, next: "admin" | "member") {
    if (!activeGroup) return;
    await api(`/v1/groups/${activeGroup}/admins`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role: next }),
    });
    openManage(activeGroup);
  }

  const isAdmin = role === "owner" || role === "admin";

  return (
    <MenuModal title={t("nav.groups")} ariaLabel={t("nav.groups")}>
      {msg && <div className="menu-modal-hint">{msg}</div>}

      <form className="menu-modal-section" onSubmit={createGroup}>
        <div className="menu-modal-section-title">{t("groups.create")}</div>
        <div className="menu-modal-panel">
          <input
            placeholder={t("groups.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="menu-modal-hint">{t("groups.inviteFriends")}</div>
        {friends.map((f) => (
          <label key={f.userId} className="menu-modal-check">
            <input
              type="checkbox"
              checked={selected.includes(f.userId)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked
                    ? [...prev, f.userId]
                    : prev.filter((id) => id !== f.userId)
                )
              }
            />
            <Avatar name={f.nickname} url={f.avatarUrl} size={28} />
            <span>{f.nickname}</span>
          </label>
        ))}
        <div className="menu-modal-panel">
          <button className="btn" disabled={busy}>
            {t("groups.createButton")}
          </button>
        </div>
      </form>

      <form className="menu-modal-section" onSubmit={joinGroup}>
        <div className="menu-modal-section-title">{t("groups.join")}</div>
        <div className="menu-modal-panel">
          <input
            placeholder={t("groups.joinPlaceholder")}
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            required
          />
          <div className="muted" style={{ fontSize: 12 }}>
            {t("groups.joinHint")}
          </div>
          <button className="btn" disabled={busy}>
            {t("groups.joinButton")}
          </button>
        </div>
      </form>

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("groups.yours")}</div>
        {groups.length === 0 && <div className="menu-modal-empty">{t("groups.empty")}</div>}
        {groups.map((g) => (
          <div className="menu-modal-list-row" key={g.id}>
            <Avatar name={g.title} url={g.avatarUrl} size={42} />
            <div className="menu-modal-list-main">
              <div className="menu-modal-list-title">{g.title}</div>
              <div className="menu-modal-list-sub">
                {g.lastMessage || t("chat.noMessagesYet")}
              </div>
            </div>
            <div className="menu-modal-list-actions">
              <button
                className="btn-ghost"
                onClick={() => router.push(`/?c=${encodeURIComponent(g.id)}`)}
              >
                {t("groups.open")}
              </button>
              <button className="btn-ghost" onClick={() => openManage(g.id)}>
                {t("groups.manage")}
              </button>
            </div>
          </div>
        ))}
      </section>

      {activeGroup && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("groups.manageTitle")}</div>
          <div className="menu-modal-hint">
            Public ID: {publicId || "—"} · Your role: {role || "—"}
          </div>
          {publicId && (
            <div className="menu-modal-panel">
              <GroupQr publicId={publicId} size={148} />
            </div>
          )}

          {isAdmin && (
            <>
              <div className="menu-modal-section-title">{t("groups.pending")}</div>
              {pending.length === 0 && (
                <div className="menu-modal-empty">{t("groups.none")}</div>
              )}
              {pending.map((p) => (
                <div className="menu-modal-list-row" key={p.user_id}>
                  <Avatar name={p.display_name} url={p.avatar_url} size={36} />
                  <div className="menu-modal-list-main">
                    <div className="menu-modal-list-title">{p.display_name}</div>
                    <div className="menu-modal-list-sub">@{p.username}</div>
                  </div>
                  <div className="menu-modal-list-actions">
                    <button className="btn-ghost" onClick={() => approve(p.user_id)}>
                      {t("groups.approve")}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="menu-modal-section-title">{t("groups.members")}</div>
          {members.map((m) => (
            <div className="menu-modal-list-row" key={m.user_id}>
              <Avatar name={m.display_name} url={m.avatar_url} size={36} />
              <div className="menu-modal-list-main">
                <div className="menu-modal-list-title">{m.display_name}</div>
                <div className="menu-modal-list-sub">
                  {m.role}
                  {m.mute_until
                    ? ` · muted until ${new Date(m.mute_until).toLocaleString()}`
                    : ""}
                </div>
              </div>
              {isAdmin && m.role !== "owner" && (
                <div className="menu-modal-list-actions">
                  <button className="btn-ghost" onClick={() => mute(m.user_id, "10m")}>
                    10m
                  </button>
                  <button className="btn-ghost" onClick={() => mute(m.user_id, "1h")}>
                    1h
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => mute(m.user_id, "permanent")}
                  >
                    {t("groups.mute")}
                  </button>
                  {m.mute_until && (
                    <button className="btn-ghost" onClick={() => mute(m.user_id, "off")}>
                      {t("groups.unmute")}
                    </button>
                  )}
                  {role === "owner" && (
                    <button
                      className="btn-ghost"
                      onClick={() =>
                        appoint(m.user_id, m.role === "admin" ? "member" : "admin")
                      }
                    >
                      {m.role === "admin" ? t("groups.demote") : t("groups.makeAdmin")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {isAdmin && (
            <div className="menu-modal-panel">
              <button
                className="btn"
                onClick={() => mute("", muteAll ? "all_off" : "all")}
              >
                {muteAll ? t("groups.unmuteAll") : t("groups.muteAll")}
              </button>
            </div>
          )}
        </section>
      )}
    </MenuModal>
  );
}
