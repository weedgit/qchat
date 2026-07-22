"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import FriendNoteEditor from "@/components/FriendNoteEditor";
import PageHeader from "@/components/PageHeader";
import { api, asList } from "@/lib/api";
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
      if (asList(body, "users").length === 0) setAddMsg("No users found.");
    } catch (err: any) {
      setAddMsg(`Failed: ${err.message}`);
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
      setAddMsg(res?.status === "accepted" ? "Friend added." : "Friend request sent.");
      setResults([]);
      setQuery("");
      load();
    } catch (e: any) {
      setAddMsg(`Failed: ${e.message}`);
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
      setAddMsg(`Failed: ${e.message}`);
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
    <AppShell rail={false}>
      <main className="page-pane">
        <PageHeader title="Friends" />

        <div className="card">
          <form className="row-inline" onSubmit={search}>
            <input
              placeholder="Search by username or user ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              required
            />
            <button className="btn" disabled={busy} style={{ flex: "none" }}>
              Search
            </button>
          </form>
          {addMsg && (
            <div
              className={addMsg.startsWith("Failed") ? "error-text" : "muted"}
              style={{ marginTop: 10 }}
            >
              {addMsg}
            </div>
          )}
          {results.map((u) => (
            <div className="list-row" key={u.id}>
              <Avatar name={u.display_name} url={u.avatar_url} size={42} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{u.display_name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  @{u.username} · {u.friend_privacy}
                </div>
              </div>
              <button className="btn" style={{ flex: "none" }} disabled={busy} onClick={() => requestUser(u)}>
                Add
              </button>
            </div>
          ))}
        </div>

        {loadError && (
          <div className="card">
            <div className="error-text">{loadError}</div>
          </div>
        )}

        {incoming.length > 0 && (
          <div className="card">
            <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Incoming requests</h2>
            {incoming.map((f) => (
              <div className="list-row" key={f.friendshipId}>
                <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{f.nickname}</div>
                  <div className="muted" style={{ fontSize: 12 }}>@{f.username}</div>
                </div>
                <button className="btn" style={{ flex: "none" }} onClick={() => accept(f)}>
                  Accept
                </button>
                <button className="btn-ghost" style={{ flex: "none" }} onClick={() => reject(f)}>
                  Reject
                </button>
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div className="card">
            <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Sent requests</h2>
            {outgoing.map((f) => (
              <div className="list-row" key={f.friendshipId}>
                <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{f.nickname}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Pending · @{f.username}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Friends</h2>
          {!loadError && accepted.length === 0 && (
            <div className="muted">No friends yet. Search above to add someone.</div>
          )}
          {accepted.map((f) => {
            const display = f.note || f.nickname;
            return (
              <div className="list-row" key={f.friendshipId}>
                <Avatar name={display} url={f.avatarUrl} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{display}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {f.note ? `${f.nickname} · ` : ""}@{f.username}
                  </div>
                  {f.tags && f.tags.length > 0 && (
                    <div className="tag-chip-row" style={{ marginTop: 4 }}>
                      {f.tags.map((t) => (
                        <span key={t} className="tag-chip">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {f.online && <span className="conn-dot on" title="Online" />}
                <button
                  className="btn-ghost"
                  style={{ flex: "none" }}
                  onClick={() => setEditingId(f.friendshipId)}
                >
                  Note
                </button>
                <button className="btn" style={{ flex: "none" }} disabled={busy} onClick={() => message(f)}>
                  Message
                </button>
                <button className="btn-ghost" style={{ flex: "none" }} onClick={() => block(f)}>
                  Block
                </button>
              </div>
            );
          })}
        </div>

        {blocked.length > 0 && (
          <div className="card">
            <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Blocked</h2>
            {blocked.map((f) => (
              <div className="list-row" key={f.friendshipId}>
                <Avatar name={f.nickname} url={f.avatarUrl} size={42} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{f.nickname}</div>
                  <div className="muted" style={{ fontSize: 12 }}>@{f.username}</div>
                </div>
                <button className="btn" style={{ flex: "none" }} onClick={() => unblock(f)}>
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="friend-note-modal" role="dialog" aria-label="Edit friend note">
            <div className="friend-note-modal-card">
              <div className="list-row" style={{ marginBottom: 12 }}>
                <Avatar name={editing.note || editing.nickname} url={editing.avatarUrl} size={48} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{editing.nickname}</div>
                  <div className="muted" style={{ fontSize: 12 }}>@{editing.username}</div>
                </div>
              </div>
              <FriendNoteEditor
                friendshipId={editing.friendshipId}
                note={editing.note ?? ""}
                tags={editing.tags ?? []}
                startOpen
                onSaved={() => {
                  setEditingId(null);
                  load();
                }}
              />
              <button
                type="button"
                className="btn-ghost"
                style={{ marginTop: 8, width: "100%" }}
                onClick={() => setEditingId(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
