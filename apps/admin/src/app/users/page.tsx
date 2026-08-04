"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AdminTime } from "@/components/AdminTime";
import Pagination from "@/components/Pagination";
import { StableLabelButton } from "@/components/StableLabelButton";
import { PasswordInput } from "@/components/PasswordInput";
import { api, asList } from "@/lib/api";
import { displayNameError } from "@/lib/credentials";
import { formatAdminError } from "@/lib/errors";
import { translateRole, translateSessionStatus, translateUserStatus } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";
import { can } from "@/lib/rbac";

import { PAGE_SIZE } from "@/lib/pagination";

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
  status: string;
  revocable: boolean;
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
    status: String(raw?.status ?? "active"),
    revocable: Boolean(raw?.revocable),
  };
}

export default function UsersPage() {
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [meRole, setMeRole] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsNeverLoggedIn, setSessionsNeverLoggedIn] = useState(false);
  const [sessionsRecentDays, setSessionsRecentDays] = useState(90);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
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
    } catch (e: any) {
      toast.error(
        t("admin.common.loadFailed", {
          target: t("admin.users.loadFailed"),
          error: formatAdminError(e, t, "admin.err.loadFailed"),
        })
      );
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

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
    try {
      const body = await api<any>(
        `/v1/admin/users/${encodeURIComponent(userId)}/sessions`
      );
      if (request !== sessionsRequestRef.current) return;
      setSessions(asList(body, "sessions").map(normalizeSession));
      setSessionsNeverLoggedIn(Boolean(body?.never_logged_in));
      setSessionsRecentDays(Number(body?.recent_days ?? 90));
    } catch (err: any) {
      if (request !== sessionsRequestRef.current) return;
      setSessions([]);
      setSessionsNeverLoggedIn(false);
      toast.error(
        t("admin.users.sessionsLoadFailed", {
          error: formatAdminError(err, t, "admin.err.loadFailed"),
        })
      );
    } finally {
      if (request === sessionsRequestRef.current) setSessionsLoading(false);
    }
  }

  function openActions(u: AdminUser) {
    setOpeningUserId(u.id);
    setTarget(u);
    setReason("");
    setNewPassword("");
    setSessions([]);
    setSessionsNeverLoggedIn(false);
    void loadSessions(u.id).finally(() => {
      setOpeningUserId((current) => (current === u.id ? null : current));
    });
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const dn = (displayName || username).trim();
    const dnErr = displayNameError(dn);
    if (dnErr) {
      toast.error(t(dnErr));
      return;
    }
    setCreateBusy(true);
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
      toast.success(t("admin.users.created"));
      setPhone("");
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("member");
      setCreateOpen(false);
      await load(query, offset);
    } catch (err: any) {
      toast.error(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setCreateBusy(false);
    }
  }

  async function runAction(fn: () => Promise<void>, done: string) {
    if (reason.trim().length < REASON_MIN) {
      toast.error(t("admin.err.reasonRequired"));
      return;
    }
    setActionBusy(true);
    try {
      await fn();
      toast.success(done);
      await load(query, offset);
    } catch (err: any) {
      toast.error(formatAdminError(err, t, "admin.err.generic"));
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
      toast.error(t("admin.err.tempPasswordRequired"));
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
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? { ...item, status: "revoked", revocable: false }
            : item
        )
      );
    }, t("admin.users.sessionSignedOut", { name }));
  }

  function closeCreateModal() {
    if (createBusy) return;
    setCreateOpen(false);
  }

  function closeManageModal() {
    if (actionBusy) return;
    setTarget(null);
    sessionsRequestRef.current += 1;
  }

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !createBusy) closeCreateModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, createBusy]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !actionBusy) closeManageModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, actionBusy]);

  const canCreate = can(meRole, "createMember") || can(meRole, "issueEnterpriseAdmin");
  const canBan = can(meRole, "ban");
  const canReset = can(meRole, "resetPassword");
  const canRevoke = can(meRole, "revokeSession");

  return (
    <AdminShell>

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
          <button className="btn" type="button" onClick={() => setCreateOpen(true)}>
            {t("admin.users.createUser")}
          </button>
        ) : null}
      </div>

      {createOpen && canCreate ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeCreateModal}
        >
          <div
            className="card card-form modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-create-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="user-create-title" className="modal-title">
              {t("admin.users.createUser")}
            </h2>
            <form onSubmit={onCreate} className="form-rows">
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
                <div className="toolbar form-actions" style={{ margin: 0 }}>
                  <button className="btn" type="submit" disabled={createBusy}>
                    {createBusy ? t("admin.common.creating") : t("admin.users.provision")}
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={createBusy}
                    onClick={closeCreateModal}
                  >
                    {t("admin.common.cancel")}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {target ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeManageModal}
        >
          <div
            className="card card-form modal-panel modal-panel-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-manage-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <button
                className="btn btn-secondary modal-close"
                type="button"
                disabled={actionBusy}
                onClick={closeManageModal}
              >
                {t("admin.common.close")}
              </button>
              <h2 id="user-manage-title" className="modal-title">
                {target.nickname}{" "}
                <span className="muted">@{target.username}</span>
              </h2>
            </div>
            <div className="field">
              <label className="modal-field-label">{t("admin.common.reasonAudited")}</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("admin.common.reasonPlaceholder")}
                rows={2}
              />
            </div>
            <div className="modal-actions-stack">
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
                <div className="modal-password-stack">
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
                </div>
              ) : null}
            </div>
            <div className="modal-section-header">
              <h3 className="modal-section-title">{t("admin.users.activeSessions")}</h3>
              <StableLabelButton
                label={
                  sessionsLoading
                    ? t("admin.common.refreshing")
                    : t("admin.common.refresh")
                }
                widthLabels={[t("admin.common.refresh"), t("admin.common.refreshing")]}
                disabled={sessionsLoading}
                onClick={() => loadSessions(target.id)}
              />
            </div>
            <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
              {t("admin.users.sessionsHint", { days: sessionsRecentDays })}
            </p>
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("admin.common.device")}</th>
                      <th>{t("admin.common.platform")}</th>
                      <th>{t("admin.common.ipLocation")}</th>
                      <th>{t("admin.common.status")}</th>
                      <th>{t("admin.common.lastActive")}</th>
                      <th>{t("admin.common.expires")}</th>
                      <th>{t("admin.common.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsLoading && sessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted">{t("admin.users.loadingSessions")}</td>
                      </tr>
                    ) : null}
                    {!sessionsLoading && sessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted">
                          {sessionsNeverLoggedIn
                            ? t("admin.users.noSessionsEver")
                            : t("admin.users.noSessions", { days: sessionsRecentDays })}
                        </td>
                      </tr>
                    ) : null}
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          {session.deviceName ||
                            session.deviceType ||
                            t("admin.common.unknownDevice")}
                        </td>
                        <td>{session.platform || "—"}</td>
                        <td>
                          <div style={{ fontFamily: "monospace", fontSize: 16 }}>{session.ip}</div>
                          <div className="muted">{session.location}</div>
                        </td>
                        <td>{translateSessionStatus(t, session.status)}</td>
                        <td className="muted">
                          <AdminTime value={session.lastActiveAt} resolved={resolved} />
                        </td>
                        <td className="muted">
                          <AdminTime value={session.expiresAt} resolved={resolved} />
                        </td>
                        <td>
                          {canRevoke && session.revocable ? (
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
      ) : null}

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
                <td style={{ fontFamily: "monospace", fontSize: 16 }}>{u.registerIp}</td>
                <td>{u.registerRegion}</td>
                <td className="muted">
                  <AdminTime value={u.createdAt} resolved={resolved} />
                </td>
                <td>
                  <StableLabelButton
                    label={
                      openingUserId === u.id
                        ? t("admin.common.loading")
                        : t("admin.common.manage")
                    }
                    widthLabels={[t("admin.common.manage"), t("admin.common.loading")]}
                    disabled={openingUserId === u.id}
                    onClick={() => openActions(u)}
                  />
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
