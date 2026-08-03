"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatApiError } from "@qchat/i18n";
import Avatar from "@/components/Avatar";
import GroupQr from "@/components/GroupQr";
import GroupQrScanner, { isGroupQrCameraSupported } from "@/components/GroupQrScanner";
import MenuModal from "@/components/MenuModal";
import { api, asList, notifyConversationsChanged } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { parseGroupJoinPayload } from "@/lib/groupQr";
import { parseUserPayload } from "@/lib/userQr";
import { useLocale } from "@/lib/locale";
import { useMe } from "@/lib/MeContext";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, isAvatarFile } from "@/lib/mediaLimits";
import {
  Conversation,
  Friend,
  formatLastSeen,
  normalizeConversation,
  normalizeFriend,
} from "@/lib/types";

interface PendingUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  enterprise_name?: string;
}

interface GroupMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: string;
  mute_until?: string;
  online?: boolean;
  last_active_at?: string;
}

/** Telegram-style stroke icons for Edit Group rows. */
function EditGroupRowIcon({ d, white }: { d: string; white?: boolean }) {
  return (
    <span className={`edit-group-row-icon${white ? " is-white" : ""}`} aria-hidden>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    </span>
  );
}

const EDIT_GROUP_ICONS = {
  administrators:
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  members:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
} as const;

export default function GroupsPage() {
  const router = useRouter();
  const { t, resolved } = useLocale();
  const { me } = useMe();
  const [groups, setGroups] = useState<Conversation[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  const [lookupHits, setLookupHits] = useState<
    { id: string; username: string; display_name: string; avatar_url?: string }[]
  >([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  /** Keep display info for selected users so they stay visible while searching. */
  const [selectedProfiles, setSelectedProfiles] = useState<
    Record<
      string,
      { id: string; username: string; display_name: string; avatar_url?: string; isFriend: boolean }
    >
  >({});
  /** Title-only form first; Create opens the invite-friends step (Telegram-style). */
  const [createStep, setCreateStep] = useState<"form" | "invite">("form");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const manageAvatarInputRef = useRef<HTMLInputElement>(null);
  const [joinId, setJoinId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [manageTitle, setManageTitle] = useState("");
  const [manageDesc, setManageDesc] = useState("");
  const [manageAvatarUrl, setManageAvatarUrl] = useState<string | undefined>(undefined);
  const [manageView, setManageView] = useState<
    "main" | "members" | "admins" | "addAdmin" | "pending" | "invite" | "addMembers"
  >("main");
  const [memberQuery, setMemberQuery] = useState("");
  const [adminQuery, setAdminQuery] = useState("");
  const [adminSelected, setAdminSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [role, setRole] = useState("");
  const [publicId, setPublicId] = useState("");
  const [muteAll, setMuteAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);
  const [inviteIdCopied, setInviteIdCopied] = useState(false);

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
    load().catch((e) => setMsg(formatApiError(e, t, "api.err.loadFailed")));
  }, [load, t]);

  useEffect(() => {
    const onChanged = () => {
      void load().catch(() => {});
    };
    window.addEventListener("qchat:conversations-changed", onChanged);
    window.addEventListener("qchat:group-pending", onChanged);
    return () => {
      window.removeEventListener("qchat:conversations-changed", onChanged);
      window.removeEventListener("qchat:group-pending", onChanged);
    };
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
    setSelectedProfiles({});
    setAvatarUrl(undefined);
    setFriendQuery("");
    setLookupHits([]);
    setCreateStep("invite");
    void load().catch(() => {});
  }

  function cancelInviteStep() {
    setCreateStep("form");
    setSelected([]);
    setSelectedProfiles({});
    setAvatarUrl(undefined);
    setFriendQuery("");
    setLookupHits([]);
    setMsg(null);
  }

  async function uploadGroupAvatar(file: File) {
    if (!isAvatarFile(file)) {
      setMsg(t("media.avatarMustBeImage"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setMsg(t("media.avatarTooLarge"));
      return;
    }
    setAvatarBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "avatar");
      const up = await api<{ url?: string }>("/v1/media/upload", { method: "POST", body: fd });
      const url = String(up?.url ?? "").trim();
      if (!url) throw new Error(t("groups.avatarUploadFailed"));
      setAvatarUrl(url);
    } catch (err: any) {
      setMsg(formatApiError(err, t, "groups.avatarUploadFailed"));
    } finally {
      setAvatarBusy(false);
    }
  }

  function toggleInvite(user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
    isFriend: boolean;
  }) {
    setSelected((prev) =>
      prev.includes(user.id) ? prev.filter((id) => id !== user.id) : [...prev, user.id]
    );
    setSelectedProfiles((prev) => {
      if (prev[user.id]) {
        const next = { ...prev };
        delete next[user.id];
        return next;
      }
      return { ...prev, [user.id]: user };
    });
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
        body: JSON.stringify({
          title: title.trim(),
          member_ids: selected,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        }),
      });
      setMsg(`Group created. ID: ${res?.public_id}`);
      setTitle("");
      setSelected([]);
      setSelectedProfiles({});
      setAvatarUrl(undefined);
      setFriendQuery("");
      setLookupHits([]);
      setCreateStep("form");
      await load();
      if (res?.id) {
        const id = String(res.id);
        notifyConversationsChanged({ selectId: id });
        router.push(`/?c=${encodeURIComponent(id)}`);
      }
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  const selectedSet = new Set(selected);
  const friendIds = new Set(friends.map((f) => f.userId));
  const selectedRows = selected
    .map((id) => selectedProfiles[id])
    .filter(Boolean) as {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
    isFriend: boolean;
  }[];
  const qTrim = friendQuery.trim();
  const searching = Boolean(qTrim);
  /** Unselected friends in list (search matches when querying; else full list). */
  const unselectedFriendRows = friends.filter((f) => {
    if (selectedSet.has(f.userId)) return false;
    return searching ? friendMatchesQuery(f, friendQuery) : true;
  });
  /** Unselected lookup hits (non-friends). */
  const unselectedLookupHits = lookupHits.filter(
    (u) => !friendIds.has(u.id) && !selectedSet.has(u.id)
  );
  const inviteEmpty =
    unselectedFriendRows.length === 0 &&
    unselectedLookupHits.length === 0 &&
    !lookupBusy;

  useEffect(() => {
    if (createStep !== "invite" && manageView !== "addMembers") return;
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
  }, [createStep, manageView, friendQuery]);

  async function requestAddContact(username: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<any>("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ username, message: "Hi!" }),
      });
      const status = String(res?.status ?? "pending");
      setJoinId("");
      setScanning(false);
      if (status === "accepted") {
        setMsg(t("contacts.friendAdded"));
      } else {
        setMsg(t("contacts.requestSent"));
      }
      window.setTimeout(() => {
        router.push(`/friends?q=${encodeURIComponent(username)}`);
      }, 700);
    } catch (err: any) {
      setMsg(formatApiError(err, t));
      setScanning(false);
      window.setTimeout(() => {
        router.push(`/friends?q=${encodeURIComponent(username)}`);
      }, 900);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinOrContact(raw: string) {
    const userName = parseUserPayload(raw);
    if (userName) {
      await requestAddContact(userName);
      return;
    }
    await requestJoin(raw);
  }

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
      const status = String(res?.status ?? "submitted");
      if (status === "already_member") {
        setMsg(t("groups.alreadyMember"));
      } else {
        setMsg(t("groups.joinPending"));
      }
      setJoinId("");
      setScanning(false);
      await load().catch(() => {});
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(e: FormEvent) {
    e.preventDefault();
    await handleJoinOrContact(joinId);
  }

  async function openManage(id: string) {
    setActiveGroup(id);
    setManageView("main");
    setMemberQuery("");
    setAdminQuery("");
    const listed = groups.find((g) => g.id === id);
    setManageTitle(listed?.title ?? "");
    setManageDesc("");
    setManageAvatarUrl(listed?.avatarUrl);
    setBusy(true);
    setMsg(null);
    try {
      const [details, pend] = await Promise.all([
        api<any>(`/v1/groups/${id}`),
        api<any>(`/v1/groups/${id}/pending`).catch(() => ({ pending: [] })),
      ]);
      setRole(String(details?.role ?? ""));
      setPublicId(String(details?.public_id ?? ""));
      setMuteAll(Boolean(details?.mute_all));
      setManageTitle(String(details?.title ?? listed?.title ?? ""));
      setManageDesc(String(details?.description ?? ""));
      setManageAvatarUrl(
        details?.avatar_url ? String(details.avatar_url) : listed?.avatarUrl
      );
      setMembers(
        asList(details, "members").map((m: any) => ({
          user_id: String(m?.user_id ?? ""),
          username: String(m?.username ?? ""),
          display_name: String(m?.display_name ?? m?.username ?? ""),
          avatar_url: m?.avatar_url || undefined,
          role: String(m?.role ?? "member"),
          mute_until: m?.mute_until ? String(m.mute_until) : undefined,
          online: Boolean(m?.online),
          last_active_at: m?.last_active_at ? String(m.last_active_at) : undefined,
        }))
      );
      setPending(asList(pend, "pending"));
    } catch (err: any) {
      setMsg(formatApiError(err, t));
      setMembers([]);
      setPending([]);
    } finally {
      setBusy(false);
    }
  }

  async function saveManageMeta() {
    if (!activeGroup || !(role === "owner" || role === "admin")) return;
    const next = manageTitle.trim();
    if (!next) {
      setMsg(t("groups.titlePlaceholder"));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const g = await api<any>(`/v1/groups/${activeGroup}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: next,
          description: manageDesc.trim(),
        }),
      });
      const saved = String(g?.title ?? next);
      setManageTitle(saved);
      setManageDesc(String(g?.description ?? manageDesc.trim()));
      setGroups((prev) =>
        prev.map((c) => (c.id === activeGroup ? { ...c, title: saved } : c))
      );
      notifyConversationsChanged();
      setActiveGroup(null);
      setManageView("main");
      setPending([]);
      setMembers([]);
      setManageTitle("");
      setManageDesc("");
      setManageAvatarUrl(undefined);
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  function closeManage() {
    setActiveGroup(null);
    setManageView("main");
    setMemberQuery("");
    setAdminQuery("");
    setAdminSelected([]);
    setPending([]);
    setMembers([]);
    setManageTitle("");
    setManageDesc("");
    setManageAvatarUrl(undefined);
    setMsg(null);
  }

  async function deleteOrLeaveGroup() {
    if (!activeGroup) return;
    setBusy(true);
    setMsg(null);
    try {
      if (role === "owner") {
        await api(`/v1/groups/${activeGroup}`, { method: "DELETE" });
      } else {
        await api(`/v1/groups/${activeGroup}/leave`, { method: "POST" });
      }
      setGroups((prev) => prev.filter((g) => g.id !== activeGroup));
      notifyConversationsChanged();
      closeManage();
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  function canRemoveMember(m: GroupMember): boolean {
    const admin = role === "owner" || role === "admin";
    if (!admin || !me?.id) return false;
    if (m.user_id === me.id) return false;
    if (m.role === "owner") return false;
    if (role === "admin" && m.role === "admin") return false;
    return true;
  }

  async function removeMember(userId: string) {
    if (!activeGroup) return;
    setBusy(true);
    setMsg(null);
    try {
      // Members panel Delete: kick user out of the group.
      await api(`/v1/groups/${activeGroup}/members/${userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      notifyConversationsChanged();
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function demoteAdmin(userId: string) {
    if (!activeGroup) return;
    setBusy(true);
    setMsg(null);
    try {
      // Administrators panel Delete: demote to common member (stay in group).
      await api(`/v1/groups/${activeGroup}/admins`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, role: "member" }),
      });
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: "member" } : m))
      );
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function uploadManageAvatar(file: File) {
    if (!activeGroup || !(role === "owner" || role === "admin")) return;
    if (!isAvatarFile(file)) {
      setMsg(t("media.avatarMustBeImage"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setMsg(t("media.avatarTooLarge"));
      return;
    }
    setAvatarBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "avatar");
      const up = await api<{ url?: string }>("/v1/media/upload", { method: "POST", body: fd });
      const url = String(up?.url ?? "").trim();
      if (!url) throw new Error(t("groups.avatarUploadFailed"));
      const g = await api<any>(`/v1/groups/${activeGroup}`, {
        method: "PATCH",
        body: JSON.stringify({ avatar_url: url }),
      });
      const saved = String(g?.avatar_url ?? url);
      setManageAvatarUrl(saved);
      setGroups((prev) =>
        prev.map((c) => (c.id === activeGroup ? { ...c, avatarUrl: saved } : c))
      );
      notifyConversationsChanged();
    } catch (err: any) {
      setMsg(formatApiError(err, t, "groups.avatarUploadFailed"));
    } finally {
      setAvatarBusy(false);
    }
  }

  const refreshPending = useCallback(async (groupId: string) => {
    try {
      const [details, pend] = await Promise.all([
        api<any>(`/v1/groups/${groupId}`),
        api<any>(`/v1/groups/${groupId}/pending`).catch(() => ({ pending: [] })),
      ]);
      setRole(String(details?.role ?? ""));
      setManageTitle(String(details?.title ?? ""));
      setManageDesc(String(details?.description ?? ""));
      setManageAvatarUrl(details?.avatar_url ? String(details.avatar_url) : undefined);
      setMuteAll(Boolean(details?.mute_all));
      setMembers(
        asList(details, "members").map((m: any) => ({
          user_id: String(m?.user_id ?? ""),
          username: String(m?.username ?? ""),
          display_name: String(m?.display_name ?? m?.username ?? ""),
          avatar_url: m?.avatar_url || undefined,
          role: String(m?.role ?? "member"),
          mute_until: m?.mute_until ? String(m.mute_until) : undefined,
          online: Boolean(m?.online),
          last_active_at: m?.last_active_at ? String(m.last_active_at) : undefined,
        }))
      );
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
    setBusy(true);
    setMsg(null);
    try {
      await api(`/v1/groups/${activeGroup}/admins`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, role: next }),
      });
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: next } : m))
      );
    } catch (err: any) {
      setMsg(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = role === "owner" || role === "admin";
  const onInviteStep = createStep === "invite";
  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().normalize("NFC").toLocaleLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const hay = [m.display_name, m.username, m.role]
        .join(" ")
        .normalize("NFC")
        .toLocaleLowerCase();
      return hay.includes(q);
    });
  }, [members, memberQuery]);

  const adminMembers = useMemo(
    () => members.filter((m) => m.role === "owner" || m.role === "admin"),
    [members]
  );

  const filteredAdmins = useMemo(() => {
    const q = adminQuery.trim().normalize("NFC").toLocaleLowerCase();
    if (!q) return adminMembers;
    return adminMembers.filter((m) => {
      const hay = [m.display_name, m.username, m.role]
        .join(" ")
        .normalize("NFC")
        .toLocaleLowerCase();
      return hay.includes(q);
    });
  }, [adminMembers, adminQuery]);

  const promotableMembers = useMemo(() => {
    const q = adminQuery.trim().normalize("NFC").toLocaleLowerCase();
    return members
      .filter((m) => m.role === "member")
      .filter((m) => {
        if (!q) return true;
        const hay = [m.display_name, m.username]
          .join(" ")
          .normalize("NFC")
          .toLocaleLowerCase();
        return hay.includes(q);
      });
  }, [members, adminQuery]);

  return (
    <>
    <MenuModal
      title={onInviteStep ? t("groups.addMembers") : t("nav.groups")}
      ariaLabel={onInviteStep ? t("groups.addMembers") : t("nav.groups")}
      overlayClassName={onInviteStep ? undefined : "groups-page-modal"}
      onClose={onInviteStep ? cancelInviteStep : undefined}
    >
      {msg && !activeGroup && <div className="menu-modal-error">{msg}</div>}

      {onInviteStep ? (
        <section className="menu-modal-section invite-members-section">
          <div className="menu-modal-hero menu-modal-invite-hero">
            <button
              type="button"
              className="avatar-edit menu-modal-avatar"
              title={t("groups.changeAvatar")}
              disabled={busy || avatarBusy}
              onClick={() => avatarInputRef.current?.click()}
            >
              <Avatar name={title || "?"} url={avatarUrl} size={96} className="is-group" />
              <span className="avatar-edit-overlay" aria-hidden>
                {"\u{1F4F7}"}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadGroupAvatar(file);
              }}
            />
            <div className="menu-modal-hero-name">{title}</div>
            <div className="menu-modal-hero-sub">
              {avatarBusy
                ? t("groups.avatarUploading")
                : t("groups.addMembersCount", { n: selected.length })}
            </div>
          </div>
          {selectedRows.length > 0 && (
            <div className="invite-selected-bar">
              {selectedRows.map((u) => (
                <button
                  type="button"
                  key={`chip-${u.id}`}
                  className="invite-selected-chip"
                  title={`@${u.username}`}
                  onClick={() => toggleInvite(u)}
                >
                  <Avatar name={u.display_name} url={u.avatar_url} size={36} />
                  <span className="invite-selected-chip-name">{u.display_name}</span>
                  <span className="invite-selected-chip-x" aria-hidden>
                    {"\u2715"}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="members-search invite-members-search">
            <span className="members-search-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
            </span>
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
          </div>
          <div className="invite-pick-list">
            {inviteEmpty && (
              <div className="menu-modal-empty">
                {friends.length === 0 && !friendQuery.trim()
                  ? t("groups.noFriendsToInvite")
                  : t("chat.noResults")}
              </div>
            )}
            {unselectedFriendRows.map((f) => {
              const label = friendLabel(f);
              return (
                <button
                  type="button"
                  key={f.userId}
                  className="invite-pick-row"
                  onClick={() =>
                    toggleInvite({
                      id: f.userId,
                      username: f.username,
                      display_name: label,
                      avatar_url: f.avatarUrl,
                      isFriend: true,
                    })
                  }
                >
                  <Avatar name={label} url={f.avatarUrl} size={42} />
                  <div className="invite-pick-main">
                    <div className="invite-pick-name">{label}</div>
                    <div className="invite-pick-sub">@{f.username}</div>
                  </div>
                </button>
              );
            })}
            {unselectedLookupHits.map((u) => (
              <button
                type="button"
                key={u.id}
                className="invite-pick-row"
                onClick={() =>
                  toggleInvite({
                    id: u.id,
                    username: u.username,
                    display_name: u.display_name,
                    avatar_url: u.avatar_url,
                    isFriend: false,
                  })
                }
              >
                <Avatar name={u.display_name} url={u.avatar_url} size={42} />
                <div className="invite-pick-main">
                  <div className="invite-pick-name">{u.display_name}</div>
                  <div className="invite-pick-sub">@{u.username}</div>
                </div>
              </button>
            ))}
            {lookupBusy && friendQuery.trim() && (
              <div className="menu-modal-empty">{t("chat.searching")}</div>
            )}
          </div>
          <div className="menu-modal-panel menu-modal-invite-actions">
            <button
              type="button"
              className="btn"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={() => void finishCreate()}
            >
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
              <button className="btn" disabled={busy} type="submit" style={{ width: "100%" }}>
                {t("groups.joinButton")}
              </button>
              {cameraOk && !scanning && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  style={{ width: "100%" }}
                  onClick={() => {
                    setMsg(null);
                    setScanning(true);
                  }}
                >
                  {t("groups.scanButton")}
                </button>
              )}
              {scanning && (
                <GroupQrScanner
                  onClose={() => setScanning(false)}
                  onDetected={(scanned) => {
                    setJoinId(scanned);
                    void handleJoinOrContact(scanned);
                  }}
                />
              )}
            </div>
          </form>

          <section className="menu-modal-section">
            <div className="menu-modal-section-title">{t("groups.yours")}</div>
            {groups.length === 0 && <div className="menu-modal-empty">{t("groups.empty")}</div>}
            {groups.map((g) => {
              const myRole = (g.role || "member").toLowerCase();
              const isPending = myRole === "pending";
              const roleLabel =
                myRole === "owner"
                  ? t("groups.roleOwner")
                  : myRole === "admin"
                    ? t("groups.roleAdmin")
                    : myRole === "pending"
                      ? t("groups.rolePending")
                      : t("groups.roleMember");
              return (
              <div className="menu-modal-list-row" key={g.id}>
                <Avatar name={g.title} url={g.avatarUrl} size={42} className="is-group" />
                <div className="menu-modal-list-main">
                  <div
                    className={`groups-list-company${g.enterpriseName ? " is-enterprise" : ""}`}
                    title={g.enterpriseName || t("account.enterprise")}
                  >
                    <svg
                      className="groups-list-company-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span>{g.enterpriseName || t("account.enterprise")}</span>
                  </div>
                  <div className="menu-modal-list-title">{g.title}</div>
                  <div className="menu-modal-list-sub">
                    {isPending
                      ? t("groups.awaitingApproval")
                      : g.lastMessage || t("chat.noMessagesYet")}
                  </div>
                </div>
                <div className="menu-modal-list-actions groups-list-actions">
                  <div className={`groups-list-role members-role-pill is-${myRole}`}>
                    {roleLabel}
                  </div>
                  {!isPending && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          notifyConversationsChanged({ selectId: g.id });
                          router.push(`/?c=${encodeURIComponent(g.id)}`);
                        }}
                      >
                        {t("groups.open")}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openManage(g.id);
                        }}
                      >
                        {t("groups.manage")}
                      </button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </section>
        </>
      )}
    </MenuModal>

    {activeGroup && (
      <MenuModal
        title={
          manageView === "addMembers"
            ? t("details.addMembers")
            : manageView === "addAdmin"
              ? t("groups.addAdministrator")
              : manageView === "admins"
                ? t("groups.administrators")
                : manageView === "members"
                  ? t("groups.members")
                  : manageView === "pending"
                    ? t("groups.pending")
                    : manageView === "invite"
                      ? t("details.inviteQr")
                      : t("groups.editGroup")
        }
        ariaLabel={t("groups.editGroup")}
        overlayClassName={`is-stacked${
          manageView === "members"
            ? " edit-members-modal"
            : manageView === "admins" || manageView === "addAdmin"
              ? " edit-admins-modal"
              : manageView === "main"
                ? " edit-group-modal"
                : ""
        }`}
        onClose={() => {
          if (manageView === "addMembers") {
            setManageView("members");
            setSelected([]);
            setSelectedProfiles({});
            setFriendQuery("");
            setLookupHits([]);
            return;
          }
          if (manageView === "addAdmin") {
            setManageView("admins");
            setAdminQuery("");
            setAdminSelected([]);
            return;
          }
          if (manageView !== "main") {
            setManageView("main");
            setMemberQuery("");
            setAdminQuery("");
            return;
          }
          closeManage();
        }}
        action={
          manageView === "main" && isAdmin ? (
            <button
              type="button"
              className="menu-modal-action"
              disabled={busy || !manageTitle.trim()}
              onClick={() => void saveManageMeta()}
            >
              {t("common.save")}
            </button>
          ) : null
        }
      >
        {msg && <div className="menu-modal-hint">{msg}</div>}

        {manageView === "main" && (
          <div className="edit-group">
            <div className="edit-group-identity">
              {isAdmin ? (
                <button
                  type="button"
                  className={`edit-group-photo${manageAvatarUrl ? " has-image" : ""}`}
                  title={t("groups.editAvatar")}
                  disabled={busy || avatarBusy}
                  onClick={() => manageAvatarInputRef.current?.click()}
                >
                  {manageAvatarUrl ? (
                    <Avatar name={manageTitle || "?"} url={manageAvatarUrl} size={64} className="is-group" />
                  ) : (
                    <span className="edit-group-photo-icon" aria-hidden>
                      {"\u{1F4F7}"}
                    </span>
                  )}
                </button>
              ) : (
                <div className={`edit-group-photo has-image${manageAvatarUrl ? "" : " is-empty"}`}>
                  <Avatar name={manageTitle || "?"} url={manageAvatarUrl} size={64} className="is-group" />
                </div>
              )}
              <input
                ref={manageAvatarInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadManageAvatar(f);
                }}
              />
              <div className="edit-group-name-field">
                <label htmlFor="edit-group-name">{t("details.groupName")}</label>
                <input
                  id="edit-group-name"
                  value={manageTitle}
                  onChange={(e) => setManageTitle(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={t("groups.titlePlaceholder")}
                  maxLength={80}
                  disabled={busy || !isAdmin}
                  autoComplete="off"
                />
              </div>
            </div>

            {isAdmin ? (
              <textarea
                className="edit-group-desc"
                value={manageDesc}
                onChange={(e) => setManageDesc(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("groups.descriptionOptional")}
                rows={2}
                maxLength={500}
                disabled={busy}
              />
            ) : manageDesc ? (
              <div className="edit-group-desc is-readonly">{manageDesc}</div>
            ) : null}

            <div className="edit-group-list">
              <button
                type="button"
                className="edit-group-row"
                onClick={() => setManageView("invite")}
              >
                <span className="edit-group-row-icon" aria-hidden>
                  {"\u{1F517}"}
                </span>
                <span className="edit-group-row-label">{t("details.inviteQr")}</span>
                <span className="edit-group-row-value">{publicId ? "1" : "0"}</span>
              </button>
              <button
                type="button"
                className="edit-group-row"
                onClick={() => {
                  setAdminQuery("");
                  setManageView("admins");
                }}
              >
                <EditGroupRowIcon d={EDIT_GROUP_ICONS.administrators} white />
                <span className="edit-group-row-label">{t("groups.administrators")}</span>
                <span className="edit-group-row-value">
                  {adminMembers.length}
                </span>
              </button>
              <button
                type="button"
                className="edit-group-row"
                onClick={() => setManageView("members")}
              >
                <EditGroupRowIcon d={EDIT_GROUP_ICONS.members} white />
                <span className="edit-group-row-label">{t("groups.members")}</span>
                <span className="edit-group-row-value">{members.length}</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="edit-group-row"
                  onClick={() => setManageView("pending")}
                >
                  <span className="edit-group-row-icon" aria-hidden>
                    {"\u{23F3}"}
                  </span>
                  <span className="edit-group-row-label">{t("groups.pending")}</span>
                  <span className="edit-group-row-value">{pending.length}</span>
                </button>
              )}
            </div>

            {isAdmin && (
              <div className="edit-group-list">
                <button
                  type="button"
                  className="edit-group-row"
                  disabled={busy}
                  onClick={() => mute("", muteAll ? "all_off" : "all")}
                >
                  <span className="edit-group-row-icon" aria-hidden>
                    {"\u{1F507}"}
                  </span>
                  <span className="edit-group-row-label">
                    {muteAll ? t("groups.unmuteAll") : t("groups.muteAll")}
                  </span>
                  <span className="edit-group-row-value">
                    {muteAll ? t("common.on") : t("common.off")}
                  </span>
                </button>
              </div>
            )}

            <div className="edit-group-list">
              <button
                type="button"
                className="edit-group-row edit-group-delete"
                disabled={busy}
                onClick={() => void deleteOrLeaveGroup()}
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        )}

        {manageView === "invite" && (
          <div className="edit-group-subpanel">
            {publicId ? (
              <div className="group-qr-block" style={{ marginTop: 0 }}>
                <div className="group-invite-id-label">
                  {t("details.inviteId")}
                </div>
                <button
                  type="button"
                  className="group-invite-id-copy"
                  title={inviteIdCopied ? t("me.idCopied") : t("chat.copy")}
                  onClick={() => {
                    void copyTextToClipboard(publicId).then((ok) => {
                      if (!ok) return;
                      setInviteIdCopied(true);
                      window.setTimeout(() => setInviteIdCopied(false), 1500);
                    });
                  }}
                >
                  <span className="group-invite-id-value">{publicId}</span>
                  <span
                    className={`group-invite-id-action${inviteIdCopied ? " is-copied" : ""}`}
                    aria-hidden
                  >
                    {inviteIdCopied ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 12l2.5 2.5 4.5-4.5" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 9h10v12H9z M5 15V3h10" />
                      </svg>
                    )}
                  </span>
                </button>
                <GroupQr publicId={publicId} size={168} />
              </div>
            ) : (
              <div className="menu-modal-empty">—</div>
            )}
          </div>
        )}

        {manageView === "pending" && (
          <div className="edit-group-subpanel">
            {pending.length === 0 && (
              <div className="menu-modal-empty">{t("groups.none")}</div>
            )}
            {pending.map((p) => (
              <div className="menu-modal-list-row" key={p.user_id}>
                <Avatar name={p.display_name} url={p.avatar_url} size={36} />
                <div className="menu-modal-list-main">
                  <div className="menu-modal-list-title">{p.display_name}</div>
                  <div className="menu-modal-list-sub">
                    @{p.username}
                    {p.enterprise_name ? ` · ${p.enterprise_name}` : ""}
                  </div>
                </div>
                <div className="menu-modal-list-actions">
                  <button className="btn-ghost" onClick={() => approve(p.user_id)}>
                    {t("groups.approve")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {manageView === "admins" && (
          <div className="members-panel">
            <div className="members-search">
              <span className="members-search-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3-3" />
                </svg>
              </span>
              <input
                value={adminQuery}
                onChange={(e) => setAdminQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("common.search")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="members-list">
              {busy && adminMembers.length === 0 && (
                <div className="menu-modal-empty">{t("common.loading")}</div>
              )}
              {!busy && filteredAdmins.length === 0 && (
                <div className="menu-modal-empty">{t("groups.none")}</div>
              )}
              {filteredAdmins.map((m) => (
                <div className="members-row" key={m.user_id}>
                  <Avatar name={m.display_name} url={m.avatar_url} size={42} />
                  <div className="members-row-main">
                    <div className="members-row-name">{m.display_name}</div>
                  </div>
                  <div className="members-row-center">
                    <span className={`members-role-pill is-${m.role}`}>
                      {m.role === "owner"
                        ? t("groups.roleOwner")
                        : m.role === "admin"
                          ? t("groups.roleAdmin")
                          : m.role}
                    </span>
                  </div>
                  <div className="members-row-right">
                    {role === "owner" && m.role === "admin" ? (
                      <button
                        type="button"
                        className="members-row-delete"
                        disabled={busy}
                        title={t("groups.demote")}
                        onClick={() => void demoteAdmin(m.user_id)}
                      >
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="members-footer">
              {role === "owner" ? (
                <button
                  type="button"
                  className="members-footer-btn"
                  onClick={() => {
                    setAdminQuery("");
                    setAdminSelected([]);
                    setManageView("addAdmin");
                  }}
                >
                  {t("groups.addAdministrator")}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="members-footer-btn"
                onClick={() => {
                  setAdminQuery("");
                  setManageView("main");
                }}
              >
                {t("chat.close")}
              </button>
            </div>
          </div>
        )}

        {manageView === "addAdmin" && (
          <div className="members-panel">
            <div className="members-search">
              <span className="members-search-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3-3" />
                </svg>
              </span>
              <input
                value={adminQuery}
                onChange={(e) => setAdminQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("common.search")}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="members-list">
              {promotableMembers.length === 0 && (
                <div className="menu-modal-empty">{t("groups.none")}</div>
              )}
              {promotableMembers.map((m) => {
                const on = adminSelected.includes(m.user_id);
                return (
                  <button
                    type="button"
                    key={m.user_id}
                    className={`members-row is-pick${on ? " is-selected" : ""}`}
                    disabled={busy}
                    onClick={() =>
                      setAdminSelected((prev) =>
                        prev.includes(m.user_id)
                          ? prev.filter((id) => id !== m.user_id)
                          : [...prev, m.user_id]
                      )
                    }
                  >
                    <Avatar name={m.display_name} url={m.avatar_url} size={42} />
                    <div className="members-row-main">
                      <div className="members-row-name">{m.display_name}</div>
                      <div className="members-row-status">@{m.username}</div>
                    </div>
                    {on && <span className="members-row-check">{"\u2713"}</span>}
                  </button>
                );
              })}
            </div>
            <div className="members-footer">
              <button
                type="button"
                className="members-footer-btn"
                disabled={busy || adminSelected.length === 0}
                onClick={async () => {
                  if (!activeGroup || adminSelected.length === 0) return;
                  setBusy(true);
                  setMsg(null);
                  try {
                    for (const userId of adminSelected) {
                      await api(`/v1/groups/${activeGroup}/admins`, {
                        method: "POST",
                        body: JSON.stringify({ user_id: userId, role: "admin" }),
                      });
                    }
                    const promoted = new Set(adminSelected);
                    setMembers((prev) =>
                      prev.map((m) =>
                        promoted.has(m.user_id) ? { ...m, role: "admin" } : m
                      )
                    );
                    setAdminSelected([]);
                    setAdminQuery("");
                    setManageView("admins");
                  } catch (err: any) {
                    setMsg(formatApiError(err, t));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("groups.add")}
              </button>
              <button
                type="button"
                className="members-footer-btn"
                onClick={() => {
                  setAdminQuery("");
                  setAdminSelected([]);
                  setManageView("admins");
                }}
              >
                {t("chat.close")}
              </button>
            </div>
          </div>
        )}

        {manageView === "members" && (
          <div className="members-panel">
            <div className="members-search">
              <span className="members-search-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3-3" />
                </svg>
              </span>
              <input
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("common.search")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="members-list">
              {busy && members.length === 0 && (
                <div className="menu-modal-empty">{t("common.loading")}</div>
              )}
              {!busy && filteredMembers.length === 0 && (
                <div className="menu-modal-empty">{t("groups.none")}</div>
              )}
              {filteredMembers.map((m) => {
                const statusOnline = Boolean(m.online);
                const statusText = statusOnline
                  ? t("presence.online")
                  : formatLastSeen(m.last_active_at, t, resolved);
                return (
                  <div className="members-row" key={m.user_id}>
                    <Avatar name={m.display_name} url={m.avatar_url} size={42} />
                    <div className="members-row-main">
                      <div className="members-row-name">{m.display_name}</div>
                      <div
                        className={`members-row-status${statusOnline ? " is-online" : ""}`}
                      >
                        {statusText}
                      </div>
                    </div>
                    <div className="members-row-center">
                      {(m.role === "owner" || m.role === "admin") && (
                        <span className={`members-role-pill is-${m.role}`}>
                          {m.role === "owner" ? t("groups.roleOwner") : t("groups.roleAdmin")}
                        </span>
                      )}
                    </div>
                    <div className="members-row-right">
                      {canRemoveMember(m) ? (
                        <button
                          type="button"
                          className="members-row-delete"
                          disabled={busy}
                          title={t("groups.removeMember")}
                          onClick={() => void removeMember(m.user_id)}
                        >
                          {t("common.delete")}
                        </button>
                      ) : (
                        <span className="members-row-delete-spacer" aria-hidden />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="members-footer">
              {isAdmin ? (
                <button
                  type="button"
                  className="members-footer-btn"
                  onClick={() => {
                    setSelected([]);
                    setSelectedProfiles({});
                    setFriendQuery("");
                    setLookupHits([]);
                    setManageView("addMembers");
                  }}
                >
                  {t("details.addMembers")}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="members-footer-btn"
                onClick={() => {
                  setMemberQuery("");
                  setManageView("main");
                }}
              >
                {t("chat.close")}
              </button>
            </div>
          </div>
        )}

        {manageView === "addMembers" && (
          <div className="members-panel">
            {selectedRows.length > 0 && (
              <div className="invite-selected-bar">
                {selectedRows.map((u) => (
                  <button
                    type="button"
                    key={`chip-${u.id}`}
                    className="invite-selected-chip"
                    title={`@${u.username}`}
                    onClick={() => toggleInvite(u)}
                  >
                    <Avatar name={u.display_name} url={u.avatar_url} size={36} />
                    <span className="invite-selected-chip-name">{u.display_name}</span>
                    <span className="invite-selected-chip-x" aria-hidden>
                      {"\u2715"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="members-search">
              <span className="members-search-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3-3" />
                </svg>
              </span>
              <input
                value={friendQuery}
                onChange={(e) => setFriendQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("groups.memberSearchPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="members-list">
              {friends
                .filter((f) => !members.some((m) => m.user_id === f.userId))
                .filter((f) => !selectedSet.has(f.userId))
                .filter((f) => friendMatchesQuery(f, friendQuery))
                .map((f) => {
                  const label = friendLabel(f);
                  return (
                    <button
                      type="button"
                      key={f.userId}
                      className="members-row is-pick"
                      onClick={() =>
                        toggleInvite({
                          id: f.userId,
                          username: f.username,
                          display_name: label,
                          avatar_url: f.avatarUrl,
                          isFriend: true,
                        })
                      }
                    >
                      <Avatar name={label} url={f.avatarUrl} size={42} />
                      <div className="members-row-main">
                        <div className="members-row-name">{label}</div>
                        <div className="members-row-status">@{f.username}</div>
                      </div>
                    </button>
                  );
                })}
              {lookupHits
                .filter((u) => !members.some((m) => m.user_id === u.id))
                .filter((u) => !friendIds.has(u.id))
                .filter((u) => !selectedSet.has(u.id))
                .map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    className="members-row is-pick"
                    onClick={() =>
                      toggleInvite({
                        id: u.id,
                        username: u.username,
                        display_name: u.display_name,
                        avatar_url: u.avatar_url,
                        isFriend: false,
                      })
                    }
                  >
                    <Avatar name={u.display_name} url={u.avatar_url} size={42} />
                    <div className="members-row-main">
                      <div className="members-row-name">{u.display_name}</div>
                      <div className="members-row-status">@{u.username}</div>
                    </div>
                  </button>
                ))}
              {lookupBusy && friendQuery.trim() && (
                <div className="menu-modal-empty">{t("chat.searching")}</div>
              )}
            </div>
            <div className="members-footer">
              <button
                type="button"
                className="members-footer-btn"
                disabled={busy || selected.length === 0}
                onClick={async () => {
                  if (!activeGroup || selected.length === 0) return;
                  setBusy(true);
                  setMsg(null);
                  try {
                    await api(`/v1/groups/${activeGroup}/members`, {
                      method: "POST",
                      body: JSON.stringify({ member_ids: selected }),
                    });
                    setSelected([]);
                    setSelectedProfiles({});
                    setFriendQuery("");
                    await refreshPending(activeGroup);
                    setManageView("members");
                    notifyConversationsChanged();
                  } catch (err: any) {
                    setMsg(formatApiError(err, t));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("details.addCount", { n: selected.length })}
              </button>
              <button
                type="button"
                className="members-footer-btn"
                onClick={() => {
                  setSelected([]);
                  setSelectedProfiles({});
                  setFriendQuery("");
                  setManageView("members");
                }}
              >
                {t("chat.close")}
              </button>
            </div>
          </div>
        )}
      </MenuModal>
    )}
    </>
  );
}
