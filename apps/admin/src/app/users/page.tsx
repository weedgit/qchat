"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { PasswordInput } from "@/components/PasswordInput";
import { api, asList } from "@/lib/api";
import { displayNameError } from "@/lib/credentials";
import { can } from "@/lib/rbac";

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

interface AdminSession {
  id: string;
  deviceType: string;
  deviceName: string;
  platform: string;
  ip: string;
  location: string;
  lastActiveAt: string;
  expiresAt: string;
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

function normalizeSession(raw: any): AdminSession {
  return {
    id: String(raw?.id ?? ""),
    deviceType: String(raw?.device_type ?? ""),
    deviceName: String(raw?.device_name ?? ""),
    platform: String(raw?.platform ?? ""),
    ip: String(raw?.ip ?? "") || "—",
    location: String(raw?.location ?? "") || "—",
    lastActiveAt: String(raw?.last_active_at ?? ""),
    expiresAt: String(raw?.expires_at ?? ""),
  };
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
  const [meRole, setMeRole] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Privileged actions target one user at a time; both are audited and need a reason.
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const sessionsRequestRef = useRef(0);

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

  useEffect(() => {
    api<any>("/v1/me")
      .then((me) => setMeRole(String(me?.role ?? "")))
      .catch(() => setMeRole(""));
  }, []);

  function search() {
    setOffset(0);
    load(query, 0);
  }

  async function loadSessions(userId: string) {
    const request = ++sessionsRequestRef.current;
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const body = await api<any>(
        `/v1/admin/users/${encodeURIComponent(userId)}/sessions`
      );
      if (request !== sessionsRequestRef.current) return;
      setSessions(asList(body, "sessions").map(normalizeSession));
    } catch (err: any) {
      if (request !== sessionsRequestRef.current) return;
      setSessions([]);
      setSessionsError(err.message);
    } finally {
      if (request === sessionsRequestRef.current) setSessionsLoading(false);
    }
  }

  function openActions(u: AdminUser) {
    setTarget(u);
    setReason("");
    setNewPassword("");
    setActionErr(null);
    setActionMsg(null);
    setSessions([]);
    void loadSessions(u.id);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const dn = (displayName || username).trim();
    const dnErr = displayNameError(dn);
    if (dnErr) {
      setCreateMsg(dnErr);
      return;
    }
    setCreateBusy(true);
    setCreateMsg(null);
    try {
      await api("/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          phone,
          username,
          display_name: dn,
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

  function revokeSession(session: AdminSession) {
    if (!target) return;
    runAction(async () => {
      await api(
        `/v1/admin/users/${encodeURIComponent(target.id)}/sessions/${encodeURIComponent(session.id)}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        }
      );
      setSessions((current) => current.filter((item) => item.id !== session.id));
    }, `Signed out ${session.platform || session.deviceType || "session"}.`);
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + users.length, total);
  const canCreate = can(meRole, "createMember") || can(meRole, "createConsoleRole");
  const canBan = can(meRole, "ban");
  const canReset = can(meRole, "resetPassword");
  const canRevoke = can(meRole, "revokeSession");

  return (
    <AdminShell>
      <h1>Users</h1>
      <div className="page-sub">
        Registered accounts and assisted provisioning.
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
        {canCreate ? (
          <button className="btn" type="button" onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? "Close form" : "Create user"}
          </button>
        ) : null}
      </div>

      {createOpen && canCreate && (
        <form className="card" onSubmit={onCreate} style={{ marginBottom: 16, padding: 16 }}>
          <div className="page-sub" style={{ marginBottom: 12 }}>
            Assisted registration — admin creates a member allowlist-style without self-service OTP.
          </div>
          <div className="form-rows" style={{ marginTop: 4 }}>
            <div className="form-row">
              <label htmlFor="admin-create-phone">Phone</label>
              <input
                id="admin-create-phone"
                placeholder="11 digits"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-username">Username</label>
              <input
                id="admin-create-username"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-display">Display name</label>
              <input
                id="admin-create-display"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-password">Temp password</label>
              <PasswordInput
                id="admin-create-password"
                placeholder="Temporary password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-role">Role</label>
              <select
                id="admin-create-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {can(meRole, "createMember") ? <option value="member">member</option> : null}
                {can(meRole, "createConsoleRole") ? (
                  <>
                    <option value="compliance">compliance</option>
                    <option value="support">support</option>
                    <option value="read_only">read_only</option>
                  </>
                ) : null}
                {can(meRole, "issueEnterpriseAdmin") ? (
                  <option value="enterprise_admin">enterprise_admin (this enterprise)</option>
                ) : null}
              </select>
            </div>
            <div className="form-row">
              <span />
              <button className="btn" type="submit" disabled={createBusy}>
                {createBusy ? "Creating…" : "Provision"}
              </button>
            </div>
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
            Blocking an account, resetting a password and remotely signing out a
            session are audited actions. Your identity, the target account and
            the reason below are recorded permanently. Existing passwords can
            never be viewed, only replaced.
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
            {canBan ? (
              <button
                className="btn"
                type="button"
                disabled={actionBusy}
                onClick={toggleBan}
              >
                {target.banned ? "Unblock sign-in" : "Block sign-in"}
              </button>
            ) : null}
            {canReset ? (
              <>
                <PasswordInput
                  placeholder="New temporary password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  className="btn"
                  type="button"
                  disabled={actionBusy}
                  onClick={resetPassword}
                >
                  Reset password
                </button>
              </>
            ) : null}
          </div>
          {actionErr && <div className="error-text" style={{ marginTop: 8 }}>{actionErr}</div>}
          {actionMsg && <div className="notice" style={{ marginTop: 8 }}>{actionMsg}</div>}
          <div style={{ marginTop: 20 }}>
            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <strong>Active sessions</strong>
              <button
                className="btn"
                type="button"
                disabled={sessionsLoading}
                onClick={() => loadSessions(target.id)}
              >
                {sessionsLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {sessionsError && (
              <div className="error-text" style={{ marginTop: 8 }}>
                Failed to load sessions: {sessionsError}
              </div>
            )}
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Platform</th>
                    <th>IP / Location</th>
                    <th>Last active</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsLoading && sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">Loading sessions…</td>
                    </tr>
                  )}
                  {!sessionsLoading && !sessionsError && sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">No active sessions.</td>
                    </tr>
                  )}
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        {session.deviceName || session.deviceType || "Unknown device"}
                      </td>
                      <td>{session.platform || "—"}</td>
                      <td>
                        <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                          {session.ip}
                        </div>
                        <div className="muted">{session.location}</div>
                      </td>
                      <td className="muted">{formatDate(session.lastActiveAt)}</td>
                      <td className="muted">{formatDate(session.expiresAt)}</td>
                      <td>
                        {canRevoke ? (
                          <button
                            className="btn"
                            type="button"
                            disabled={actionBusy}
                            onClick={() => revokeSession(session)}
                          >
                            Sign out
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
