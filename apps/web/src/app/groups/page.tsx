"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import GroupQr from "@/components/GroupQr";
import { api, asList } from "@/lib/api";
import { parseGroupJoinPayload } from "@/lib/groupQr";
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
    setFriends(asList(friendBody, "friends").map(normalizeFriend).filter((f) => f.status === "accepted"));
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
      const publicId = parseGroupJoinPayload(joinId) ?? joinId.trim();
      if (!publicId) {
        setMsg("Enter a group ID or paste a scanned QR payload.");
        return;
      }
      const res = await api<any>("/v1/groups/join", {
        method: "POST",
        body: JSON.stringify({ public_id: publicId }),
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
    <AppShell>
      <main className="page-pane">
        <h1>Groups</h1>
        {msg && <div className="card muted">{msg}</div>}

        <form className="card" onSubmit={createGroup} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Create group</h2>
          <input placeholder="Group title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <div className="muted" style={{ fontSize: 12 }}>Invite friends (optional)</div>
          {friends.map((f) => (
            <label key={f.userId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={selected.includes(f.userId)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, f.userId] : prev.filter((id) => id !== f.userId)
                  )
                }
              />
              <Avatar name={f.nickname} url={f.avatarUrl} size={28} />
              <span>{f.nickname}</span>
            </label>
          ))}
          <button className="btn" disabled={busy}>Create</button>
        </form>

        <form className="card" onSubmit={joinGroup} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Join by ID or QR</h2>
          <input
            placeholder="Gxxxxxxxx or paste qchat://join/…"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            required
          />
          <div className="muted" style={{ fontSize: 12 }}>
            Scan a group QR with your phone camera, then paste the result here — or type the invite ID.
          </div>
          <button className="btn" disabled={busy}>Request to join</button>
        </form>

        <div className="card">
          <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Your groups</h2>
          {groups.length === 0 && <div className="muted">No groups yet.</div>}
          {groups.map((g) => (
            <div className="list-row" key={g.id}>
              <Avatar name={g.title} url={g.avatarUrl} size={42} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{g.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{g.lastMessage || "No messages"}</div>
              </div>
              <button className="btn" style={{ flex: "none" }} onClick={() => router.push(`/?c=${encodeURIComponent(g.id)}`)}>
                Open
              </button>
              <button className="btn-ghost" style={{ flex: "none" }} onClick={() => openManage(g.id)}>
                Manage
              </button>
            </div>
          ))}
        </div>

        {activeGroup && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Manage group</h2>
            <div className="muted">Public ID: {publicId || "—"} · Your role: {role || "—"}</div>
            {publicId && <GroupQr publicId={publicId} size={148} />}

            {isAdmin && (
              <>
                <h3 style={{ margin: 0, fontSize: 14 }}>Pending requests</h3>
                {pending.length === 0 && <div className="muted">None</div>}
                {pending.map((p) => (
                  <div className="list-row" key={p.user_id}>
                    <Avatar name={p.display_name} url={p.avatar_url} size={36} />
                    <div style={{ flex: 1 }}>{p.display_name} (@{p.username})</div>
                    <button className="btn" style={{ flex: "none" }} onClick={() => approve(p.user_id)}>
                      Approve
                    </button>
                  </div>
                ))}
              </>
            )}

            <h3 style={{ margin: 0, fontSize: 14 }}>Members</h3>
            {members.map((m) => (
              <div className="list-row" key={m.user_id}>
                <Avatar name={m.display_name} url={m.avatar_url} size={36} />
                <div style={{ flex: 1 }}>
                  <div>{m.display_name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {m.role}{m.mute_until ? ` · muted until ${new Date(m.mute_until).toLocaleString()}` : ""}
                  </div>
                </div>
                {isAdmin && m.role !== "owner" && (
                  <>
                    <button className="btn-ghost" style={{ flex: "none" }} onClick={() => mute(m.user_id, "10m")}>10m</button>
                    <button className="btn-ghost" style={{ flex: "none" }} onClick={() => mute(m.user_id, "1h")}>1h</button>
                    <button className="btn-ghost" style={{ flex: "none" }} onClick={() => mute(m.user_id, "permanent")}>Mute</button>
                    {m.mute_until && (
                      <button className="btn-ghost" style={{ flex: "none" }} onClick={() => mute(m.user_id, "off")}>Unmute</button>
                    )}
                    {role === "owner" && (
                      <button
                        className="btn-ghost"
                        style={{ flex: "none" }}
                        onClick={() => appoint(m.user_id, m.role === "admin" ? "member" : "admin")}
                      >
                        {m.role === "admin" ? "Demote" : "Make admin"}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            {isAdmin && (
              <button className="btn" onClick={() => mute("", muteAll ? "all_off" : "all")}>
                {muteAll ? "Unmute whole group" : "Mute whole group"}
              </button>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}
