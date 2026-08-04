"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AdminTime } from "@/components/AdminTime";
import Pagination from "@/components/Pagination";
import { StableLabelButton } from "@/components/StableLabelButton";
import { PasswordInput } from "@/components/PasswordInput";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { displayEnterpriseName, translateInviteStatus } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";
import { can } from "@/lib/rbac";

import { PAGE_SIZE } from "@/lib/pagination";
interface Enterprise {
  id: string;
  name: string;
  inviteCode: string;
  inviteActive: boolean;
  retentionDays: number;
  createdAt: string;
}

function normalize(raw: any): Enterprise {
  return {
    id: String(raw?.id ?? raw?.enterprise_id ?? ""),
    name: String(raw?.name ?? raw?.title ?? ""),
    inviteCode: String(raw?.invite_code ?? ""),
    inviteActive: Boolean(raw?.invite_active ?? false),
    retentionDays: Number(raw?.retention_days ?? 90),
    createdAt: String(raw?.created_at ?? raw?.createdAt ?? ""),
  };
}

export default function EnterprisesPage() {
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [rows, setRows] = useState<Enterprise[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<Record<string, string>>({});
  const [meRole, setMeRole] = useState<string>("");

  const [createName, setCreateName] = useState("");
  const [createInvite, setCreateInvite] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [issueFor, setIssueFor] = useState<Enterprise | null>(null);
  const [issuePhone, setIssuePhone] = useState("");
  const [issueUsername, setIssueUsername] = useState("");
  const [issuePassword, setIssuePassword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const isPlatformAdmin = meRole === "platform_admin" || meRole === "platform_owner";
  const canInvite = can(meRole, "manageInvite");
  const canRetention = can(meRole, "writeEnterprise");

  const load = useCallback(async (q: string, off: number, background = false) => {
    if (!background) setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(off),
      });
      if (q.trim()) qs.set("q", q.trim());
      const body = await api<any>(`/v1/admin/enterprises?${qs.toString()}`);
      const list = asList(body, "enterprises").map(normalize);
      setRows(list);
      setTotal(Number(body?.total ?? list.length));
      const drafts: Record<string, string> = {};
      for (const e of list) drafts[e.id] = String(e.retentionDays);
      setRetentionDraft((prev) => ({ ...prev, ...drafts }));
    } catch (e: any) {
      toast.error(
        t("admin.common.loadFailed", {
          target: t("admin.enterprises.loadFailed"),
          error: formatAdminError(e, t, "admin.err.loadFailed"),
        })
      );
      setRows([]);
      setTotal(0);
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

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load(query, 0);
  }

  function reload() {
    return load(query, offset, true);
  }

  async function rotateInvite(entId: string) {
    setBusy(`invite-rotate-${entId}`);
    try {
      const body = await api<any>(`/v1/admin/enterprises/${encodeURIComponent(entId)}/invite/rotate`, {
        method: "POST",
        body: "{}",
      });
      toast.success(t("admin.enterprises.inviteRotated", { code: body?.invite_code }));
      await reload();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function setInviteActive(entId: string, active: boolean) {
    setBusy(active ? `invite-activate-${entId}` : `invite-revoke-${entId}`);
    try {
      await api(`/v1/admin/enterprises/${encodeURIComponent(entId)}/invite/${active ? "activate" : "revoke"}`, {
        method: "POST",
        body: "{}",
      });
      toast.success(
        active ? t("admin.enterprises.inviteActivated") : t("admin.enterprises.inviteRevoked")
      );
      await reload();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function saveRetention(id: string) {
    setBusy(`retention-${id}`);
    try {
      const days = Number(retentionDraft[id] ?? 90);
      await api(`/v1/admin/enterprises/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ retention_days: days }),
      });
      toast.success(t("admin.enterprises.retentionSet", { days }));
      await reload();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function runRetention() {
    setBusy("run-retention");
    try {
      const body = await api<any>("/v1/admin/retention/run", { method: "POST", body: "{}" });
      toast.success(t("admin.enterprises.retentionDeleted", { count: body?.deleted ?? 0 }));
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function createEnterprise(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    try {
      const body = await api<any>("/v1/admin/enterprises", {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          invite_code: createInvite.trim() || undefined,
          admin_phone: adminPhone.trim(),
          admin_password: adminPassword,
          admin_username: adminUsername.trim() || undefined,
        }),
      });
      toast.success(
        t("admin.enterprises.created", {
          name: createName.trim(),
          code: body?.invite_code,
          username: body?.admin_username,
        })
      );
      setCreateName("");
      setCreateInvite("");
      setAdminPhone("");
      setAdminUsername("");
      setAdminPassword("");
      setCreateOpen(false);
      await reload();
    } catch (err: any) {
      toast.error(formatAdminError(err, t, "admin.enterprises.createFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function issueAdmin(e: FormEvent) {
    e.preventDefault();
    if (!issueFor) return;
    setBusy("issue");
    try {
      const body = await api<any>("/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          phone: issuePhone.trim(),
          password: issuePassword,
          username: issueUsername.trim(),
          role: "enterprise_admin",
          enterprise_id: issueFor.id,
        }),
      });
      toast.success(
        t("admin.enterprises.issued", {
          username: body?.username,
          name: displayEnterpriseName(issueFor.name, issueFor.inviteCode),
        })
      );
      setIssueFor(null);
      setIssuePhone("");
      setIssueUsername("");
      setIssuePassword("");
    } catch (err: any) {
      toast.error(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy !== "create") setCreateOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, busy]);

  function closeCreateModal() {
    if (busy === "create") return;
    setCreateOpen(false);
  }

  return (
    <AdminShell>

      <div className="toolbar-anchor">
        <form className="toolbar toolbar-full" onSubmit={onSearch}>
          <input
            placeholder={t("admin.enterprises.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" type="submit" disabled={loading}>
            {t("admin.common.search")}
          </button>
          {isPlatformAdmin ? (
            <button className="btn" type="button" onClick={() => setCreateOpen(true)}>
              {t("admin.enterprises.createEnterprise")}
            </button>
          ) : null}
          {canRetention ? (
            <StableLabelButton
              label={
                busy === "run-retention"
                  ? t("admin.enterprises.running")
                  : t("admin.enterprises.runRetention")
              }
              widthLabels={[
                t("admin.enterprises.runRetention"),
                t("admin.enterprises.running"),
              ]}
              disabled={!!busy}
              onClick={runRetention}
            />
          ) : null}
        </form>
      </div>

      {createOpen && isPlatformAdmin ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeCreateModal}
        >
          <div
            className="card card-form modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ent-create-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ent-create-title" style={{ margin: "0 0 8px", fontSize: 20 }}>
              {t("admin.enterprises.createTitle")}
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>{t("admin.enterprises.createBlurb")}</p>
            <form onSubmit={createEnterprise} className="form-rows">
              <div className="form-row">
                <label htmlFor="ent-create-name">{t("admin.enterprises.companyName")}</label>
                <input
                  id="ent-create-name"
                  required
                  placeholder={t("admin.enterprises.companyPlaceholder")}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="ent-create-invite">{t("admin.enterprises.inviteCode")}</label>
                <input
                  id="ent-create-invite"
                  placeholder={t("admin.common.optional")}
                  value={createInvite}
                  onChange={(e) => setCreateInvite(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="ent-create-phone">{t("admin.enterprises.adminPhone")}</label>
                <input
                  id="ent-create-phone"
                  required
                  placeholder={t("admin.common.phonePlaceholder")}
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="ent-create-username">{t("admin.enterprises.adminUsername")}</label>
                <input
                  id="ent-create-username"
                  placeholder={t("admin.common.optional")}
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="ent-create-password">{t("admin.enterprises.adminPassword")}</label>
                <PasswordInput
                  id="ent-create-password"
                  required
                  placeholder={t("admin.common.password")}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-row">
                <span />
                <div className="toolbar form-actions" style={{ margin: 0 }}>
                  <button className="btn" type="submit" disabled={busy === "create"}>
                    {busy === "create" ? t("admin.common.creating") : t("admin.enterprises.createEnterprise")}
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy === "create"}
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

      {issueFor ? (
        <div className="card card-form">
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>
            {t("admin.enterprises.issueAdminFor", {
              name: displayEnterpriseName(issueFor.name, issueFor.inviteCode),
            })}
          </h2>
          <form onSubmit={issueAdmin} className="form-rows">
            <div className="form-row">
              <label htmlFor="ent-issue-phone">{t("admin.common.phone")}</label>
              <input
                id="ent-issue-phone"
                required
                placeholder={t("admin.common.phonePlaceholder")}
                value={issuePhone}
                onChange={(e) => setIssuePhone(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-issue-username">{t("admin.common.username")}</label>
              <input
                id="ent-issue-username"
                required
                placeholder={t("admin.common.username")}
                value={issueUsername}
                onChange={(e) => setIssueUsername(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-issue-password">{t("admin.common.password")}</label>
              <PasswordInput
                id="ent-issue-password"
                required
                placeholder={t("admin.common.password")}
                value={issuePassword}
                onChange={(e) => setIssuePassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="form-row">
              <span />
              <div className="toolbar form-actions" style={{ margin: 0 }}>
                <button className="btn" type="submit" disabled={busy === "issue"}>
                  {busy === "issue" ? t("admin.enterprises.issuing") : t("admin.enterprises.issueAdmin")}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!!busy}
                  onClick={() => setIssueFor(null)}
                >
                  {t("admin.common.cancel")}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t("admin.common.name")}</th>
              <th>{t("admin.enterprises.inviteCodeCol")}</th>
              <th>{t("admin.enterprises.invite")}</th>
              <th>{t("admin.enterprises.retentionDays")}</th>
              <th>{t("admin.common.created")}</th>
              {isPlatformAdmin ? <th>{t("admin.common.actions")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={isPlatformAdmin ? 6 : 5} className="muted">
                  {t("admin.common.loading")}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={isPlatformAdmin ? 6 : 5} className="muted">
                  {t("admin.enterprises.noEnterprises")}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{displayEnterpriseName(r.name, r.inviteCode)}</td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "nowrap",
                    }}
                  >
                    <span style={{ fontFamily: "monospace" }}>{r.inviteCode}</span>
                    {canInvite ? (
                      <StableLabelButton
                        label={
                          busy === `invite-rotate-${r.id}`
                            ? t("admin.enterprises.rotating")
                            : t("admin.enterprises.rotateInvite")
                        }
                        widthLabels={[
                          t("admin.enterprises.rotateInvite"),
                          t("admin.enterprises.rotating"),
                        ]}
                        disabled={!!busy}
                        onClick={() => rotateInvite(r.id)}
                      />
                    ) : null}
                  </div>
                </td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "nowrap",
                    }}
                  >
                    <span className={`pill ${r.inviteActive ? "ok" : "warn"}`}>
                      {translateInviteStatus(t, r.inviteActive)}
                    </span>
                    {canInvite ? (
                      <StableLabelButton
                        className={r.inviteActive ? "btn-danger" : undefined}
                        label={
                          busy === `invite-revoke-${r.id}` ||
                          busy === `invite-activate-${r.id}`
                            ? r.inviteActive
                              ? t("admin.enterprises.stopping")
                              : t("admin.enterprises.activating")
                            : r.inviteActive
                              ? t("admin.enterprises.inviteStop")
                              : t("admin.enterprises.inviteActiveAction")
                        }
                        widthLabels={[
                          t("admin.enterprises.inviteStop"),
                          t("admin.enterprises.stopping"),
                          t("admin.enterprises.inviteActiveAction"),
                          t("admin.enterprises.activating"),
                        ]}
                        disabled={!!busy}
                        onClick={() => setInviteActive(r.id, !r.inviteActive)}
                      />
                    ) : null}
                  </div>
                </td>
                <td>
                  {canRetention ? (
                    <div className="toolbar" style={{ gap: 6, margin: 0 }}>
                      <input
                        style={{ width: 72 }}
                        value={retentionDraft[r.id] ?? String(r.retentionDays)}
                        onChange={(e) =>
                          setRetentionDraft((d) => ({ ...d, [r.id]: e.target.value }))
                        }
                      />
                      <button
                        className="btn"
                        type="button"
                        disabled={busy === `retention-${r.id}`}
                        onClick={() => saveRetention(r.id)}
                      >
                        {t("admin.common.save")}
                      </button>
                    </div>
                  ) : (
                    <span>{t("admin.enterprises.days", { days: r.retentionDays })}</span>
                  )}
                </td>
                <td className="muted">
                  <AdminTime value={r.createdAt} resolved={resolved} />
                </td>
                {isPlatformAdmin ? (
                  <td>
                    <button
                      className="btn"
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        setIssueFor(r);
                        setIssuePhone("");
                        setIssueUsername("");
                        setIssuePassword("");
                      }}
                    >
                      {t("admin.enterprises.issueAdminBtn")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        total={total}
        offset={offset}
        pageSize={PAGE_SIZE}
        visibleCount={rows.length}
        loading={loading}
        onPageChange={setOffset}
        emptyLabel={t("admin.enterprises.noEnterprises")}
      />
    </AdminShell>
  );
}
