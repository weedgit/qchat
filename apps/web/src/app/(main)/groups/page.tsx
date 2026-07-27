"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import GroupQr from "@/components/GroupQr";
import GroupQrScanner, { isGroupQrCameraSupported } from "@/components/GroupQrScanner";
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
  const [friendQuery, setFriendQuery] = useState("");
  const [lookupHits, setLookupHits] = useState<
    { id: string; username: string; display_name: string; avatar_url?: string }[]
  >([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  /** Title-only form first; Create opens the invite-friends step (Telegram-style). */
  const [createStep, setCreateStep] = useState<"form" | "invite">("form");
  const [joinId, setJoinId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [role, setRole] = useState("");
  const [publicId, setPublicId] = useState("");
  const [muteAll, setMuteAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);

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

  useEffect(() => {
    setCameraOk(isGroupQrCameraSupported());
  }, []);

  function openInviteStep(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setMsg(t("groups.titlePlaceholder"));
      return;
    }
    setTitle(trimmed);
    setMsg(null);
    setSelected([]);
    setFriendQuery("");
    setLookupHits([]);
    setCreateStep("invite");
    void load().catch(() => {});
  }

  function cancelInviteStep() {
    setCreateStep("form");
    setSelected([]);
    setFriendQuery("");
    setLookupHits([]);
    setMsg(null);
  }

  function toggleFriend(userId: string) {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function friendLabel(f: Friend): string {
    const note = (f.note ?? "").trim();
    if (note && note !== f.nickname) return `${note} | ${f.nickname}`;
    return f.nickname;
  }

  function friendMatchesQuery(f: Friend, raw: string): boolean {
    const q = raw.trim().normalize("NFC").toLocaleLowerCase();
    if (!q) return true;
    const parts = [f.nickname, f.username, f.note, f.userId, ...(f.tags ?? [])];
    const hay = parts
      .filter(Boolean)
      .join(" ")
      .normalize("NFC")
      .toLocaleLowerCase();
    return hay.includes(q);
  }

  async function finishCreate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<any>("/v1/groups", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), member_ids: selected }),
      });
      setMsg(`Group created. ID: ${res?.public_id}`);
      setTitle("");
      setSelected([]);
      setFriendQuery("");
      setLookupHits([]);
      setCreateStep("form");
      await load();
      if (res?.id) router.push(`/?c=${encodeURIComponent(res.id)}`);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inviteFriends = friends.filter((f) => friendMatchesQuery(f, friendQuery));
  const friendIds = new Set(friends.map((f) => f.userId));
  const nonFriendHits = lookupHits.filter((u) => !friendIds.has(u.id));

  useEffect(() => {
    if (createStep !== "invite") return;
    const q = friendQuery.trim();
    if (!q) {
      setLookupHits([]);
      setLookupBusy(false);
      return;
    }
    let cancelled = false;
    setLookupBusy(true);
    const timer = window.setTimeout(() => {
      api<any>(`/v1/users/lookup?q=${encodeURIComponent(q)}`)
        .then((body) => {
          if (cancelled) return;
          setLookupHits(
            asList(body, "users").map((u: any) => ({
              id: String(u?.id ?? ""),
              username: String(u?.username ?? ""),
              display_name: String(u?.display_name ?? u?.username ?? ""),
              avatar_url: u?.avatar_url || undefined,
            })).filter((u: { id: string }) => u.id)
          );
        })
        .catch(() => {
          if (!cancelled) setLookupHits([]);
        })
        .finally(() => {
          if (!cancelled) setLookupBusy(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [createStep, friendQuery]);

  async function requestJoin(publicIdRaw: string) {
    const parsed = parseGroupJoinPayload(publicIdRaw) ?? publicIdRaw.trim();
    if (!parsed) {
      setMsg(t("groups.invalidJoin"));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<any>("/v1/groups/join", {
        method: "POST",
        body: JSON.stringify({ public_id: parsed }),
      });
      setMsg(`Join request: ${res?.status ?? "submitted"}`);
      setJoinId("");
      setScanning(false);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(e: FormEvent) {
    e.preventDefault();
    await requestJoin(joinId);
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

  const refreshPending = useCallback(async (groupId: string) => {
    try {
      const [details, pend] = await Promise.all([
        api<any>(`/v1/groups/${groupId}`),
        api<any>(`/v1/groups/${groupId}/pending`).catch(() => ({ pending: [] })),
      ]);
      setRole(String(details?.role ?? ""));
      setMembers(asList(details, "members"));
      setPending(asList(pend, "pending"));
    } catch {
      /* keep existing pending UI */
    }
  }, []);

  useEffect(() => {
    if (!activeGroup) return;
    const onPending = (ev: Event) => {
      const detail = (ev as CustomEvent<{ conversation_id?: string }>).detail;
      if (detail?.conversation_id !== activeGroup) return;
      void refreshPending(activeGroup);
    };
    window.addEventListener("qchat:group-pending", onPending);
    return () => window.removeEventListener("qchat:group-pending", onPending);
  }, [activeGroup, refreshPending]);

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
  const onInviteStep = createStep === "invite";

  return (
    <MenuModal
      title={onInviteStep ? t("groups.addMembers") : t("nav.groups")}
      ariaLabel={onInviteStep ? t("groups.addMembers") : t("nav.groups")}
      onClose={onInviteStep ? cancelInviteStep : undefined}
    >
      {msg && <div className="menu-modal-hint">{msg}</div>}

      {onInviteStep ? (
        <section className="menu-modal-section">
          <div className="menu-modal-hint" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{title}</span>
            <span>{t("groups.addMembersCount", { n: selected.length })}</span>
          </div>
          <div className="menu-modal-panel">
            <form
              className="menu-modal-search-row"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="search"
                placeholder={t("groups.memberSearchPlaceholder")}
                value={friendQuery}
                onChange={(e) => setFriendQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </form>
          </div>
          <div className="menu-modal-hint" style={{ fontSize: 12 }}>
            {t("groups.inviteFriendsOnly")}
          </div>
          {inviteFriends.length === 0 && nonFriendHits.length === 0 && !lookupBusy && (
            <div className="menu-modal-empty">
              {friends.length === 0 && !friendQuery.trim()
                ? t("groups.noFriendsToInvite")
                : t("chat.noResults")}
            </div>
          )}
          {inviteFriends.map((f) => {
            const checked = selected.includes(f.userId);
            const label = friendLabel(f);
            return (
              <button
                type="button"
                key={f.userId}
                className={`menu-modal-list-row${checked ? " is-selected" : ""}`}
                onClick={() => toggleFriend(f.userId)}
              >
                <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden />
                <Avatar name={label} url={f.avatarUrl} size={42} />
                <div className="menu-modal-list-main">
                  <div className="menu-modal-list-title">{label}</div>
                  <div className="menu-modal-list-sub">@{f.username}</div>
                </div>
              </button>
            );
          })}
          {nonFriendHits.map((u) => {
            const checked = selected.includes(u.id);
            return (
              <button
                type="button"
                key={u.id}
                className={`menu-modal-list-row${checked ? " is-selected" : ""}`}
                onClick={() => toggleFriend(u.id)}
              >
                <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden />
                <Avatar name={u.display_name} url={u.avatar_url} size={42} />
                <div className="menu-modal-list-main">
                  <div className="menu-modal-list-title">{u.display_name}</div>
                  <div className="menu-modal-list-sub">
                    @{u.username} · {t("groups.notAFriend")}
                  </div>
                </div>
              </button>
            );
          })}
          {lookupBusy && friendQuery.trim() && (
            <div className="menu-modal-empty">{t("chat.searching")}</div>
          )}
          <div className="menu-modal-panel menu-modal-invite-actions">
            <button type="button" className="btn-ghost" disabled={busy} onClick={cancelInviteStep}>
              {t("groups.cancel")}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void finishCreate()}>
              {t("groups.createButton")}
            </button>
          </div>
        </section>
      ) : (
        <>
          <form className="menu-modal-section" onSubmit={openInviteStep}>
            <div className="menu-modal-section-title">{t("groups.create")}</div>
            <div className="menu-modal-panel">
              <input
                placeholder={t("groups.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="menu-modal-panel">
              <button className="btn" disabled={busy} type="submit">
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
                required={!scanning}
              />
              <div className="muted" style={{ fontSize: 12 }}>
                {t("groups.joinHint")}
              </div>
              <div className="menu-modal-search-row" style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy} type="submit">
                  {t("groups.joinButton")}
                </button>
                {cameraOk && !scanning && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      setMsg(null);
                      setScanning(true);
                    }}
                  >
                    {t("groups.scanButton")}
                  </button>
                )}
              </div>
              {scanning && (
                <GroupQrScanner
                  onClose={() => setScanning(false)}
                  onDetected={(publicIdScanned) => {
                    setJoinId(publicIdScanned);
                    void requestJoin(publicIdScanned);
                  }}
                />
              )}
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
        </>
      )}
    </MenuModal>
  );
}
