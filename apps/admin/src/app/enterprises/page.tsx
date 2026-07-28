"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { PasswordInput } from "@/components/PasswordInput";
import { api, asList } from "@/lib/api";
import { can } from "@/lib/rbac";

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
  const [rows, setRows] = useState<Enterprise[]>([]);
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

  const isPlatformOwner = meRole === "platform_owner";
  const canInvite = can(meRole, "manageInvite");
  const canRetention = can(meRole, "writeEnterprise");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api<any>("/v1/admin/enterprises");
      const list = asList(body, "enterprises").map(normalize);
      setRows(list);
      const drafts: Record<string, string> = {};
      for (const e of list) drafts[e.id] = String(e.retentionDays);
      setRetentionDraft(drafts);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api<any>("/v1/me")
      .then((me) => setMeRole(String(me?.role ?? "")))
      .catch(() => setMeRole(""));
  }, [load]);

  async function rotateInvite() {
    setBusy("rotate");
    setNotice(null);
    try {
      const body = await api<any>("/v1/admin/invite/rotate", { method: "POST", body: "{}" });
      setNotice(`Invite rotated to ${body?.invite_code}`);
      await load();
    } catch (e: any) {
      setNotice(e.message);
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
      setNotice(active ? "Invite activated." : "Invite revoked.");
      await load();
    } catch (e: any) {
      setNotice(e.message);
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
      setNotice(`Retention set to ${days} days.`);
      await load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function runRetention() {
    setBusy("run-retention");
    setNotice(null);
    try {
      const body = await api<any>("/v1/admin/retention/run", { method: "POST", body: "{}" });
      setNotice(`Retention job deleted ${body?.deleted ?? 0} messages.`);
    } catch (e: any) {
      setNotice(e.message);
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
        `Created ${createName.trim()} · invite ${body?.invite_code} · admin @${body?.admin_username}`
      );
      setCreateName("");
      setCreateInvite("");
      setAdminPhone("");
      setAdminUsername("");
      setAdminPassword("");
      await load();
    } catch (err: any) {
      setNotice(err.message);
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
      setNotice(`Issued enterprise admin @${body?.username} for ${issueFor.name}.`);
      setIssueFor(null);
      setIssuePhone("");
      setIssueUsername("");
      setIssuePassword("");
    } catch (err: any) {
      setNotice(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <h1>Enterprises</h1>
      <div className="page-sub">
        Organizations, invite codes, and 90-day history retention (DataRetention).
      </div>

      <div className="toolbar">
        {canInvite ? (
          <>
            <button className="btn" type="button" disabled={!!busy} onClick={rotateInvite}>
              {busy === "rotate" ? "Rotating…" : "Rotate invite"}
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => setInviteActive(false)}>
              {busy === "revoke" ? "Revoking…" : "Revoke invite"}
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => setInviteActive(true)}>
              {busy === "activate" ? "Activating…" : "Activate invite"}
            </button>
          </>
        ) : null}
        {canRetention ? (
          <button className="btn" type="button" disabled={!!busy} onClick={runRetention}>
            {busy === "run-retention" ? "Running…" : "Run retention now"}
          </button>
        ) : null}
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="notice">Failed to load enterprises: {error}</div>}

      {isPlatformOwner ? (
        <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Create enterprise + admin</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Platform owners issue a company and its first enterprise administrator account.
          </p>
          <form onSubmit={createEnterprise} className="form-rows">
            <div className="form-row">
              <label htmlFor="ent-create-name">Company name</label>
              <input
                id="ent-create-name"
                required
                placeholder="Acme Corp"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-create-invite">Invite code</label>
              <input
                id="ent-create-invite"
                placeholder="Optional"
                value={createInvite}
                onChange={(e) => setCreateInvite(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-create-phone">Admin phone</label>
              <input
                id="ent-create-phone"
                required
                placeholder="11 digits"
                value={adminPhone}
                onChange={(e) => setAdminPhone(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-create-username">Admin username</label>
              <input
                id="ent-create-username"
                placeholder="Optional"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-create-password">Admin password</label>
              <PasswordInput
                id="ent-create-password"
                required
                placeholder="Password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="form-row">
              <span />
              <button className="btn" type="submit" disabled={busy === "create"}>
                {busy === "create" ? "Creating…" : "Create enterprise"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {issueFor ? (
        <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>
            Issue admin for {issueFor.name}
          </h2>
          <form onSubmit={issueAdmin} className="form-rows">
            <div className="form-row">
              <label htmlFor="ent-issue-phone">Phone</label>
              <input
                id="ent-issue-phone"
                required
                placeholder="11 digits"
                value={issuePhone}
                onChange={(e) => setIssuePhone(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-issue-username">Username</label>
              <input
                id="ent-issue-username"
                required
                placeholder="Username"
                value={issueUsername}
                onChange={(e) => setIssueUsername(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ent-issue-password">Password</label>
              <PasswordInput
                id="ent-issue-password"
                required
                placeholder="Password"
                value={issuePassword}
                onChange={(e) => setIssuePassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="form-row">
              <span />
              <div className="toolbar" style={{ margin: 0 }}>
                <button className="btn" type="submit" disabled={busy === "issue"}>
                  {busy === "issue" ? "Issuing…" : "Issue enterprise admin"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={!!busy}
                  onClick={() => setIssueFor(null)}
                >
                  Cancel
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
              <th>Name</th>
              <th>Invite code</th>
              <th>Invite</th>
              <th>Retention (days)</th>
              <th>Created</th>
              {isPlatformOwner ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isPlatformOwner ? 6 : 5} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={isPlatformOwner ? 6 : 5} className="muted">
                  No enterprises found.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td style={{ fontFamily: "monospace" }}>{r.inviteCode}</td>
                <td>
                  <span className={`pill ${r.inviteActive ? "ok" : "warn"}`}>
                    {r.inviteActive ? "active" : "revoked"}
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
                        Save
                      </button>
                    </div>
                  ) : (
                    <span>{r.retentionDays} days</span>
                  )}
                </td>
                <td className="muted">{r.createdAt}</td>
                {isPlatformOwner ? (
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
                      Issue admin
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
