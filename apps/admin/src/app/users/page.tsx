"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pagination from "@/components/Pagination";
import { PasswordInput } from "@/components/PasswordInput";
import { api, asList } from "@/lib/api";
import { displayNameError } from "@/lib/credentials";
import { formatAdminError } from "@/lib/errors";
import { translateRole, translateUserStatus } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { can } from "@/lib/rbac";

import { PAGE_SIZE } from "@/lib/pagination";const REASON_MIN = 8;

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
  const { t } = useLocale();
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
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load(query, offset);
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
      setSessionsError(formatAdminError(err, t, "admin.err.loadFailed"));
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
      setCreateMsg(t(dnErr));
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
      setCreateMsg(t("admin.users.created"));
      setPhone("");
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("member");
      setCreateOpen(false);
      await load(query, offset);
    } catch (err: any) {
      setCreateMsg(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setCreateBusy(false);
    }
  }

  async function runAction(fn: () => Promise<void>, done: string) {
    if (reason.trim().length < REASON_MIN) {
      setActionErr(t("admin.err.reasonRequired"));
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
      setActionErr(formatAdminError(err, t, "admin.err.generic"));
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
      banned ? t("admin.users.blocked") : t("admin.users.unblocked")
    );
  }

  function resetPassword() {
    if (!target) return;
    if (!newPassword) {
      setActionErr(t("admin.err.tempPasswordRequired"));
      return;
    }
    runAction(async () => {
      await api(`/v1/admin/users/${encodeURIComponent(target.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: newPassword, reason: reason.trim() }),
      });
      setNewPassword("");
    }, t("admin.users.passwordReset"));
  }

  function revokeSession(session: AdminSession) {
    if (!target) return;
    const name = session.platform || session.deviceType || "session";
    runAction(async () => {
      await api(
        `/v1/admin/users/${encodeURIComponent(target.id)}/sessions/${encodeURIComponent(session.id)}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        }
      );
      setSessions((current) => current.filter((item) => item.id !== session.id));
    }, t("admin.users.sessionSignedOut", { name }));
  }

  const canCreate = can(meRole, "createMember") || can(meRole, "issueEnterpriseAdmin");
  const canBan = can(meRole, "ban");
  const canReset = can(meRole, "resetPassword");
  const canRevoke = can(meRole, "revokeSession");

  return (
    <AdminShell>
      <h1>{t("admin.nav.users")}</h1>
      <div className="page-sub">{t("admin.users.subtitle")}</div>

      <div className="toolbar toolbar-full">
        <input
          placeholder={t("admin.users.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="btn" onClick={search}>
          {t("admin.common.search")}
        </button>
        {canCreate ? (
          <button className="btn" type="button" onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? t("admin.users.closeForm") : t("admin.users.createUser")}
          </button>
        ) : null}
      </div>

      {createOpen && canCreate && (
        <form className="card" onSubmit={onCreate} style={{ marginBottom: 16, padding: 16 }}>
          <div className="page-sub" style={{ marginBottom: 12 }}>
            {t("admin.users.createBlurb")}
          </div>
          <div className="form-rows" style={{ marginTop: 4 }}>
            <div className="form-row">
              <label htmlFor="admin-create-phone">{t("admin.common.phone")}</label>
              <input
                id="admin-create-phone"
                placeholder={t("admin.common.phonePlaceholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-username">{t("admin.common.username")}</label>
              <input
                id="admin-create-username"
                placeholder={t("admin.common.username")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-display">{t("admin.common.displayName")}</label>
              <input
                id="admin-create-display"
                placeholder={t("admin.common.displayName")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-password">{t("admin.common.tempPassword")}</label>
              <PasswordInput
                id="admin-create-password"
                placeholder={t("admin.common.tempPassword")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-create-role">{t("admin.common.role")}</label>
              <select
                id="admin-create-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="member">{translateRole(t, "member")}</option>
                {can(meRole, "issueEnterpriseAdmin") ? (
                  <option value="enterprise_admin">
                    {translateRole(t, "enterprise_admin")}
                  </option>
                ) : null}
              </select>
            </div>
            <div className="form-row">
              <span />
              <button className="btn" type="submit" disabled={createBusy}>
                {createBusy ? t("admin.common.creating") : t("admin.users.provision")}
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
              {t("admin.common.close")}
            </button>
          </div>
          <div className="notice" style={{ marginTop: 12 }}>{t("admin.users.actionsBlurb")}</div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t("admin.common.reasonAudited")}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("admin.common.reasonPlaceholder")}
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
                {target.banned ? t("admin.users.unblockSignIn") : t("admin.users.blockSignIn")}
              </button>
            ) : null}
            {canReset ? (
              <>
                <PasswordInput
                  placeholder={t("admin.users.newTempPassword")}
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
                  {t("admin.users.resetPassword")}
                </button>
              </>
            ) : null}
          </div>
          {actionErr && <div className="error-text" style={{ marginTop: 8 }}>{actionErr}</div>}
          {actionMsg && <div className="notice" style={{ marginTop: 8 }}>{actionMsg}</div>}
          <div style={{ marginTop: 20 }}>
            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <strong>{t("admin.users.activeSessions")}</strong>
              <button
                className="btn"
                type="button"
                disabled={sessionsLoading}
                onClick={() => loadSessions(target.id)}
              >
                {sessionsLoading ? t("admin.common.refreshing") : t("admin.common.refresh")}
              </button>
            </div>
            {sessionsError && (
              <div className="error-text" style={{ marginTop: 8 }}>
                {t("admin.users.sessionsLoadFailed", { error: sessionsError })}
              </div>
            )}
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("admin.common.device")}</th>
                    <th>{t("admin.common.platform")}</th>
                    <th>{t("admin.common.ipLocation")}</th>
                    <th>{t("admin.common.lastActive")}</th>
                    <th>{t("admin.common.expires")}</th>
                    <th>{t("admin.common.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsLoading && sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">{t("admin.users.loadingSessions")}</td>
                    </tr>
                  )}
                  {!sessionsLoading && !sessionsError && sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">{t("admin.users.noSessions")}</td>
                    </tr>
                  )}
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        {session.deviceName ||
                          session.deviceType ||
                          t("admin.common.unknownDevice")}
                      </td>
                      <td>{session.platform || "—"}</td>
                      <td>
                        <div style={{ fontFamily: "monospace", fontSize: 12 }}>{session.ip}</div>
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
                            {t("admin.common.signOut")}
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

      {error && (
        <div className="notice">
          {t("admin.common.loadFailed", { target: t("admin.users.loadFailed"), error })}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t("admin.common.phone")}</th>
              <th>{t("admin.common.nickname")}</th>
              <th>{t("admin.common.username")}</th>
              <th>{t("admin.common.status")}</th>
              <th>{t("admin.common.registerIp")}</th>
              <th>{t("admin.common.region")}</th>
              <th>{t("admin.common.created")}</th>
              <th>{t("admin.common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="muted">{t("admin.common.loading")}</td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">{t("admin.users.noUsersFound")}</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.phone}</td>
                <td>{u.nickname}</td>
                <td className="muted">@{u.username}</td>
                <td>
                  <span className={`pill ${u.status === "active" ? "ok" : "danger"}`}>
                    {translateUserStatus(t, u.status)}
                  </span>
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{u.registerIp}</td>
                <td>{u.registerRegion}</td>
                <td className="muted">{u.createdAt}</td>
                <td>
                  <button className="btn" type="button" onClick={() => openActions(u)}>
                    {t("admin.common.manage")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        total={total}
        offset={offset}
        pageSize={PAGE_SIZE}
        visibleCount={users.length}
        loading={loading}
        onPageChange={setOffset}
        emptyLabel={t("admin.users.noUsers")}
      />
    </AdminShell>
  );
}
