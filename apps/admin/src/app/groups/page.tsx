"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AdminTime } from "@/components/AdminTime";
import Pagination from "@/components/Pagination";
import { StableLabelButton } from "@/components/StableLabelButton";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { translateGroupMemberRole, translateGroupStatus } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";
import { can } from "@/lib/rbac";

import { PAGE_SIZE } from "@/lib/pagination";

interface AdminGroup {
  id: string;
  publicId: string;
  title: string;
  ownerId: string;
  ownerDisplayName: string;
  ownerUsername: string;
  memberCount: number;
  createdAt: string;
  status: string;
  isEnterpriseDefault: boolean;
}

interface GroupMember {
  userId: string;
  username: string;
  displayName: string;
  role: string;
}

interface GroupDetail {
  id: string;
  title: string;
  publicId: string;
  ownerId: string;
  ownerDisplayName: string;
  ownerUsername: string;
  status: string;
  isEnterpriseDefault: boolean;
  members: GroupMember[];
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function normalize(raw: any): AdminGroup {
  let ownerDisplayName = String(raw?.owner_display_name ?? "").trim();
  let ownerUsername = String(raw?.owner_username ?? "").trim();
  // Never surface raw ids in name fields (legacy rows or partial API responses).
  if (isUuidLike(ownerDisplayName)) ownerDisplayName = "";
  if (isUuidLike(ownerUsername)) ownerUsername = "";
  return {
    id: String(raw?.id ?? ""),
    publicId: String(raw?.public_id ?? ""),
    title: String(raw?.title ?? ""),
    ownerId: String(raw?.owner_id ?? ""),
    ownerDisplayName,
    ownerUsername,
    memberCount: Number(raw?.member_count ?? 0),
    createdAt: String(raw?.created_at ?? ""),
    status: String(raw?.status ?? "active"),
    isEnterpriseDefault: Boolean(raw?.is_enterprise_default),
  };
}

function normalizeMember(raw: any): GroupMember {
  return {
    userId: String(raw?.user_id ?? ""),
    username: String(raw?.username ?? ""),
    displayName: String(raw?.display_name ?? ""),
    role: String(raw?.role ?? "member"),
  };
}

function normalizeDetail(raw: any): GroupDetail {
  return {
    id: String(raw?.id ?? ""),
    title: String(raw?.title ?? ""),
    publicId: String(raw?.public_id ?? ""),
    ownerId: String(raw?.owner_id ?? ""),
    ownerDisplayName: String(raw?.owner_display_name ?? ""),
    ownerUsername: String(raw?.owner_username ?? ""),
    status: String(raw?.status ?? "active"),
    isEnterpriseDefault: Boolean(raw?.is_enterprise_default),
    members: asList(raw, "members").map(normalizeMember).filter((m) => m.userId),
  };
}

export default function GroupsPage() {
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [rows, setRows] = useState<AdminGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [meRole, setMeRole] = useState("");
  const [target, setTarget] = useState<GroupDetail | null>(null);
  const [openingGroupId, setOpeningGroupId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const canManage = can(meRole, "writeEnterprise");

  const load = useCallback(async (q: string, off: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(off),
      });
      if (q.trim()) qs.set("q", q.trim());
      const body = await api<any>(`/v1/admin/groups?${qs.toString()}`);
      setRows(asList(body, "groups").map(normalize).filter((g: AdminGroup) => g.id));
      setTotal(Number(body?.total ?? 0));
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
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

  async function openManage(group: AdminGroup) {
    setOpeningGroupId(group.id);
    try {
      const body = await api<any>(`/v1/admin/groups/${encodeURIComponent(group.id)}`);
      setTarget(normalizeDetail(body));
    } catch (e: any) {
      setTarget(null);
      toast.error(
        t("admin.common.loadFailed", {
          target: t("admin.groups.loadFailed"),
          error: formatAdminError(e, t, "admin.err.loadFailed"),
        })
      );
    } finally {
      setOpeningGroupId(null);
    }
  }

  function closeManage() {
    if (actionBusy) return;
    setTarget(null);
  }

  async function refreshTarget() {
    if (!target) return;
    const body = await api<any>(`/v1/admin/groups/${encodeURIComponent(target.id)}`);
    setTarget(normalizeDetail(body));
    await load(query, offset);
  }

  async function removeMember(member: GroupMember) {
    if (!target || !canManage) return;
    setActionBusy(true);
    try {
      await api(
        `/v1/admin/groups/${encodeURIComponent(target.id)}/members/${encodeURIComponent(member.userId)}`,
        { method: "DELETE" }
      );
      toast.success(t("admin.groups.memberRemoved"));
      await refreshTarget();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.generic"));
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteGroup() {
    if (!target || !canManage) return;
    if (target.isEnterpriseDefault) {
      toast.error(t("admin.groups.enterpriseDefault"));
      return;
    }
    setActionBusy(true);
    try {
      await api(`/v1/admin/groups/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      toast.success(t("admin.groups.deleted"));
      setTarget(null);
      await load(query, offset);
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.generic"));
    } finally {
      setActionBusy(false);
    }
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load(query, 0);
  }

  return (
    <AdminShell>

      <form className="toolbar toolbar-full" onSubmit={onSearch} style={{ marginBottom: 16 }}>
        <input
          placeholder={t("admin.groups.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {t("admin.common.search")}
        </button>
      </form>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t("admin.common.title")}</th>
              <th>{t("admin.common.publicId")}</th>
              <th>{t("admin.common.owner")}</th>
              <th>{t("admin.common.members")}</th>
              <th>{t("admin.common.status")}</th>
              <th>{t("admin.common.created")}</th>
              <th>{t("admin.common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="muted">{t("admin.common.loading")}</td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">{t("admin.groups.noGroupsFound")}</td>
              </tr>
            ) : null}
            {rows.map((g) => (
              <tr key={g.id}>
                <td>{g.title || "—"}</td>
                <td>
                  <code>{g.publicId || "—"}</code>
                </td>
                <td>
                  <div>{g.ownerDisplayName || "—"}</div>
                  <div className="muted" style={{ fontSize: 16 }}>
                    {g.ownerUsername ? `@${g.ownerUsername}` : "—"}
                  </div>
                </td>
                <td>{g.memberCount}</td>
                <td>
                  <span className={`pill ${g.status === "active" ? "ok" : "danger"}`}>
                    {translateGroupStatus(t, g.status)}
                  </span>
                </td>
                <td className="muted">
                  <AdminTime value={g.createdAt} resolved={resolved} />
                </td>
                <td>
                  <StableLabelButton
                    label={
                      openingGroupId === g.id
                        ? t("admin.common.loading")
                        : t("admin.common.manage")
                    }
                    widthLabels={[t("admin.common.manage"), t("admin.common.loading")]}
                    disabled={openingGroupId === g.id}
                    onClick={() => openManage(g)}
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
        visibleCount={rows.length}
        loading={loading}
        onPageChange={setOffset}
        emptyLabel={t("admin.groups.noGroupsFound")}
      />

      {target ? (
        <div className="modal-backdrop" role="presentation" onClick={closeManage}>
          <div
            className="card card-form modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-manage-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <button
                className="btn btn-secondary modal-close"
                type="button"
                disabled={actionBusy}
                onClick={closeManage}
              >
                {t("admin.common.close")}
              </button>
              <h2 id="group-manage-title" className="modal-title">
                {target.title || target.publicId || target.id}
              </h2>
            </div>
            <div className="security-inline-row" style={{ marginBottom: 16 }}>
              <span>
                <code>{target.publicId || "—"}</code>
              </span>
              <span className={`pill ${target.status === "active" ? "ok" : "danger"}`}>
                {translateGroupStatus(t, target.status)}
              </span>
              <span className="muted">
                {t("admin.common.owner")}: {target.ownerDisplayName || "—"}
                {target.ownerUsername ? ` (@${target.ownerUsername})` : ""}
              </span>
            </div>

            <h3 className="modal-section-title" style={{ marginBottom: 12 }}>
              {t("admin.groups.manageMembers")}
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("admin.common.nickname")}</th>
                    <th>{t("admin.common.username")}</th>
                    <th>{t("admin.common.role")}</th>
                    {canManage ? <th>{t("admin.common.action")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {target.members.length === 0 ? (
                    <tr>
                      <td colSpan={canManage ? 4 : 3} className="muted">
                        {t("admin.groups.noMembers")}
                      </td>
                    </tr>
                  ) : null}
                  {target.members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.displayName || "—"}</td>
                      <td className="muted">@{m.username}</td>
                      <td>{translateGroupMemberRole(t, m.role)}</td>
                      {canManage ? (
                        <td>
                          {m.role === "owner" ? (
                            <span className="muted">—</span>
                          ) : (
                            <button
                              className="btn btn-danger"
                              type="button"
                              disabled={actionBusy}
                              onClick={() => removeMember(m)}
                            >
                              {t("admin.groups.removeMember")}
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canManage ? (
              <div className="modal-actions-stack" style={{ marginTop: 16 }}>
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={actionBusy || target.isEnterpriseDefault}
                  onClick={() => deleteGroup()}
                >
                  {actionBusy ? t("admin.groups.deleting") : t("admin.groups.deleteGroup")}
                </button>
                {target.isEnterpriseDefault ? (
                  <p className="muted" style={{ margin: 0 }}>{t("admin.groups.enterpriseDefault")}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
