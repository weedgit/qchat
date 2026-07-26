"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

const PAGE_SIZE = 50;
const REASON_MIN = 8;

interface AdminUser {
  id: string;
  phone: string;
  nickname: string;
  username: string;
  status: string;
  banned: boolean;
  enterprise: string;
  registerIp: string;
  registerRegion: string;
  createdAt: string;
}

function normalize(raw: any): AdminUser {
  const banned = Boolean(raw?.banned);
  return {
    id: String(raw?.id ?? raw?.user_id ?? ""),
    phone: String(raw?.phone ?? ""),
    nickname: String(raw?.display_name ?? raw?.nickname ?? raw?.name ?? ""),
    username: String(raw?.username ?? ""),
    status: String(raw?.status ?? (banned ? "banned" : "active")),
    banned,
    enterprise: String(raw?.enterprise_name ?? raw?.enterprise_id ?? "—"),
    registerIp: String(raw?.register_ip ?? "") || "—",
    registerRegion: String(raw?.register_region ?? "") || "—",
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? ""),
  };
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Privileged actions target one user at a time; both are audited and need a reason.
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async (q: string, from: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(from),
      });
      if (q.trim()) qs.set("q", q.trim());
      const body = await api<any>(`/v1/admin/users?${qs.toString()}`);
      setUsers(asList(body, "users").map(normalize));
      setTotal(Number(body?.total ?? 0));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(query, offset);
    // Reloads are driven explicitly by search and paging, not by keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, offset]);

  function search() {
    setOffset(0);
    load(query, 0);
  }

  function openActions(u: AdminUser) {
    setTarget(u);
    setReason("");
    setNewPassword("");
    setActionErr(null);
    setActionMsg(null);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateMsg(null);
    try {
      await api("/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          phone,
          username,
          display_name: displayName || username,
          password,
          role,
        }),
      });
      setCreateMsg("User created.");
      setPhone("");
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("member");
      setCreateOpen(false);
      await load(query, offset);
    } catch (err: any) {
      setCreateMsg(err.message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function runAction(fn: () => Promise<void>, done: string) {
    if (reason.trim().length < REASON_MIN) {
      setActionErr(`A reason of at least ${REASON_MIN} characters is required.`);
      return;
    }
    setActionBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      await fn();
      setActionMsg(done);
      await load(query, offset);
    } catch (err: any) {
      setActionErr(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  function toggleBan() {
    if (!target) return;
    const banned = !target.banned;
    runAction(
      async () => {
        await api(`/v1/admin/users/${encodeURIComponent(target.id)}/ban`, {
          method: "POST",
          body: JSON.stringify({ banned, reason: reason.trim() }),
        });
        setTarget({ ...target, banned, status: banned ? "banned" : "active" });
      },
      banned
        ? "User blocked. All sessions were signed out."
        : "User unblocked. They can sign in again."
    );
  }

  function resetPassword() {
    if (!target) return;
    if (!newPassword) {
      setActionErr("A temporary password is required.");
      return;
    }
    runAction(async () => {
      await api(`/v1/admin/users/${encodeURIComponent(target.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: newPassword, reason: reason.trim() }),
      });
      setNewPassword("");
    }, "Password reset. All sessions were signed out; share the temporary password securely.");
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + users.length, total);

  return (
    <AdminShell>
      <h1>Users</h1>
      <div className="page-sub">
        Registered accounts and assisted provisioning (no SMS OTP required).
      </div>

      <div className="toolbar">
        <input
          placeholder="Search by phone, username or display name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="btn" onClick={search}>
          Search
        </button>
        <button className="btn" type="button" onClick={() => setCreateOpen((v) => !v)}>
          {createOpen ? "Close form" : "Create user"}
        </button>
      </div>

      {createOpen && (
        <form className="card" onSubmit={onCreate} style={{ marginBottom: 16, padding: 16 }}>
          <div className="page-sub" style={{ marginBottom: 12 }}>
            Assisted registration — admin creates a member allowlist-style without self-service OTP.
          </div>
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              placeholder="Phone (11 digits)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <input
              type="password"
              placeholder="Temp password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">member</option>
              <option value="enterprise_admin">enterprise_admin</option>
            </select>
            <button className="btn" type="submit" disabled={createBusy}>
              {createBusy ? "Creating…" : "Provision"}
            </button>
          </div>
          {createMsg && <div className="notice" style={{ marginTop: 8 }}>{createMsg}</div>}
        </form>
      )}

      {target && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <strong>
              {target.nickname} <span className="muted">@{target.username}</span>
            </strong>
            <button className="btn" type="button" onClick={() => setTarget(null)}>
              Close
            </button>
          </div>
          <div className="notice" style={{ marginTop: 12 }}>
            Blocking an account and resetting a password are audited actions. Your
            identity, the target account and the reason below are recorded
            permanently. Existing passwords can never be viewed, only replaced.
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Reason (required, recorded in audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Compliance ticket #1234 — account takeover reported"
              rows={2}
            />
          </div>
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <button
              className="btn"
              type="button"
              disabled={actionBusy}
              onClick={toggleBan}
            >
              {target.banned ? "Unblock sign-in" : "Block sign-in"}
            </button>
            <input
              type="password"
              placeholder="New temporary password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              className="btn"
              type="button"
              disabled={actionBusy}
              onClick={resetPassword}
            >
              Reset password
            </button>
          </div>
          {actionErr && <div className="error-text" style={{ marginTop: 8 }}>{actionErr}</div>}
          {actionMsg && <div className="notice" style={{ marginTop: 8 }}>{actionMsg}</div>}
        </div>
      )}

      {error && <div className="notice">Failed to load users: {error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Phone</th>
              <th>Nickname</th>
              <th>Username</th>
              <th>Status</th>
              <th>Register IP</th>
              <th>Region</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="muted">Loading…</td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">No users found.</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.phone}</td>
                <td>{u.nickname}</td>
                <td className="muted">@{u.username}</td>
                <td>
                  <span className={`pill ${u.status === "active" ? "ok" : "danger"}`}>
                    {u.status}
                  </span>
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{u.registerIp}</td>
                <td>{u.registerRegion}</td>
                <td className="muted">{u.createdAt}</td>
                <td>
                  <button className="btn" type="button" onClick={() => openActions(u)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 12 }}>
        <span className="muted">
          {total === 0 ? "No users" : `Showing ${from}–${to} of ${total}`}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            className="btn"
            type="button"
            disabled={loading || to >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </span>
      </div>
    </AdminShell>
  );
}
