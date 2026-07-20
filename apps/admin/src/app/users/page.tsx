"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, asList } from "@/lib/api";

interface AdminUser {
  id: string;
  phone: string;
  nickname: string;
  username: string;
  status: string;
  enterprise: string;
  registerIp: string;
  registerRegion: string;
  createdAt: string;
}

function normalize(raw: any): AdminUser {
  return {
    id: String(raw?.id ?? raw?.user_id ?? ""),
    phone: String(raw?.phone ?? ""),
    nickname: String(raw?.display_name ?? raw?.nickname ?? raw?.name ?? ""),
    username: String(raw?.username ?? ""),
    status: String(raw?.status ?? (raw?.banned ? "banned" : "active")),
    enterprise: String(raw?.enterprise_name ?? raw?.enterprise_id ?? "—"),
    registerIp: String(raw?.register_ip ?? "") || "—",
    registerRegion: String(raw?.register_region ?? "") || "—",
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? ""),
  };
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
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

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : "";
      const body = await api<any>(`/v1/admin/users${qs}`);
      setUsers(asList(body, "users").map(normalize));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      await load(query);
    } catch (err: any) {
      setCreateMsg(err.message);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1>Users</h1>
      <div className="page-sub">
        Registered accounts and assisted provisioning (no SMS OTP required).
      </div>

      <div className="toolbar">
        <input
          placeholder="Search by phone or nickname"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(query)}
        />
        <button className="btn" onClick={() => load(query)}>
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
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="muted">Loading…</td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">No users found.</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
