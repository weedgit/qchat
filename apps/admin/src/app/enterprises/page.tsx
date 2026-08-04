"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pagination from "@/components/Pagination";
import { PasswordInput } from "@/components/PasswordInput";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { translateInviteStatus } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
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
  const { t } = useLocale();
  const [rows, setRows] = useState<Enterprise[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const isPlatformAdmin = meRole === "platform_admin" || meRole === "platform_owner";
  const canInvite = can(meRole, "manageInvite");
  const canRetention = can(meRole, "writeEnterprise");

  const load = useCallback(async (q: string, off: number) => {
    setLoading(true);
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
      setError(null);
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
      setRows([]);
      setTotal(0);
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

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load(query, 0);
  }

  function reload() {
    return load(query, offset);
  }

  async function rotateInvite() {
    setBusy("rotate");
    setNotice(null);
    try {
      const body = await api<any>("/v1/admin/invite/rotate", { method: "POST", body: "{}" });
      setNotice(t("admin.enterprises.inviteRotated", { code: body?.invite_code }));
      await reload();
    } catch (e: any) {
      setNotice(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function setInviteActive(active: boolean) {
    setBusy(active ? "activate" : "revoke");
    setNotice(null);
    try {
      await api(`/v1/admin/invite/${active ? "activate" : "revoke"}`, {
        method: "POST",
        body: "{}",
      });
      setNotice(
        active ? t("admin.enterprises.inviteActivated") : t("admin.enterprises.inviteRevoked")
      );
      await reload();
    } catch (e: any) {
      setNotice(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function saveRetention(id: string) {
    setBusy(`retention-${id}`);
    setNotice(null);
    try {
      const days = Number(retentionDraft[id] ?? 90);
      await api(`/v1/admin/enterprises/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ retention_days: days }),
      });
      setNotice(t("admin.enterprises.retentionSet", { days }));
      await reload();
    } catch (e: any) {
      setNotice(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function runRetention() {
    setBusy("run-retention");
    setNotice(null);
    try {
      const body = await api<any>("/v1/admin/retention/run", { method: "POST", body: "{}" });
      setNotice(t("admin.enterprises.retentionDeleted", { count: body?.deleted ?? 0 }));
    } catch (e: any) {
      setNotice(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function createEnterprise(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setNotice(null);
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
      setNotice(
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
      await reload();
    } catch (err: any) {
      setNotice(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function issueAdmin(e: FormEvent) {
    e.preventDefault();
    if (!issueFor) return;
    setBusy("issue");
    setNotice(null);
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
      setNotice(
        t("admin.enterprises.issued", {
          username: body?.username,
          name: issueFor.name,
        })
      );
      setIssueFor(null);
      setIssuePhone("");
      setIssueUsername("");
      setIssuePassword("");
    } catch (err: any) {
      setNotice(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <h1>{t("admin.nav.enterprises")}</h1>
      <div className="page-sub">{t("admin.enterprises.subtitle")}</div>

      <div className="toolbar">
        {canInvite ? (
          <>
            <button className="btn" type="button" disabled={!!busy} onClick={rotateInvite}>
              {busy === "rotate" ? t("admin.enterprises.rotating") : t("admin.enterprises.rotateInvite")}
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => setInviteActive(false)}>
              {busy === "revoke" ? t("admin.enterprises.revoking") : t("admin.enterprises.revokeInvite")}
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => setInviteActive(true)}>
              {busy === "activate" ? t("admin.enterprises.activating") : t("admin.enterprises.activateInvite")}
            </button>
          </>
        ) : null}
        {canRetention ? (
          <button className="btn" type="button" disabled={!!busy} onClick={runRetention}>
            {busy === "run-retention" ? t("admin.enterprises.running") : t("admin.enterprises.runRetention")}
          </button>
        ) : null}
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && (
        <div className="notice">
          {t("admin.common.loadFailed", { target: t("admin.enterprises.loadFailed"), error })}
        </div>
      )}

      <form className="toolbar toolbar-full" onSubmit={onSearch} style={{ marginBottom: 16 }}>
        <input
          placeholder={t("admin.enterprises.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {t("admin.common.search")}
        </button>
      </form>

      {isPlatformAdmin ? (
        <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("admin.enterprises.createTitle")}</h2>
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
              <button className="btn" type="submit" disabled={busy === "create"}>
                {busy === "create" ? t("admin.common.creating") : t("admin.enterprises.createEnterprise")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {issueFor ? (
        <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>
            {t("admin.enterprises.issueAdminFor", { name: issueFor.name })}
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
              <div className="toolbar" style={{ margin: 0 }}>
                <button className="btn" type="submit" disabled={busy === "issue"}>
                  {busy === "issue" ? t("admin.enterprises.issuing") : t("admin.enterprises.issueAdmin")}
                </button>
                <button
                  className="btn"
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
            {loading && (
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
                <td>{r.name}</td>
                <td style={{ fontFamily: "monospace" }}>{r.inviteCode}</td>
                <td>
                  <span className={`pill ${r.inviteActive ? "ok" : "warn"}`}>
                    {translateInviteStatus(t, r.inviteActive)}
                  </span>
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
                <td className="muted">{r.createdAt}</td>
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
                        setNotice(null);
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
