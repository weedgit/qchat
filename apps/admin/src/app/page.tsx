"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { api, asList, API_URL } from "@/lib/api";

export default function OverviewPage() {
  const [counts, setCounts] = useState<{
    users?: number;
    enterprises?: number;
    audits?: number;
    groups?: number;
  }>({});

  useEffect(() => {
    api<any>("/v1/admin/users?limit=1")
      .then((b) => setCounts((c) => ({ ...c, users: b?.total ?? asList(b, "users").length })))
      .catch(() => {});
    api<any>("/v1/admin/groups?limit=1")
      .then((b) => setCounts((c) => ({ ...c, groups: b?.total ?? asList(b, "groups").length })))
      .catch(() => {});
    api<any>("/v1/admin/enterprises?limit=1")
      .then((b) => setCounts((c) => ({ ...c, enterprises: b?.total ?? asList(b, "enterprises").length })))
      .catch(() => {});
    api<any>("/v1/admin/audits?limit=1")
      .then((b) => setCounts((c) => ({ ...c, audits: b?.total ?? asList(b, "audits", "logs").length })))
      .catch(() => {});
  }, []);

  return (
    <AdminShell>
      <h1>Overview</h1>
      <div className="page-sub">Rchat administration console · API {API_URL}</div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">{counts.users ?? "—"}</div>
          <div className="k">Users</div>
        </div>
        <div className="stat-card">
          <div className="v">{counts.groups ?? "—"}</div>
          <div className="k">Groups</div>
        </div>
        <div className="stat-card">
          <div className="v">{counts.enterprises ?? "—"}</div>
          <div className="k">Enterprises</div>
        </div>
        <div className="stat-card">
          <div className="v">{counts.audits ?? "—"}</div>
          <div className="k">Audit entries</div>
        </div>
      </div>

      <div className="card">
        <p className="muted">
          Use the sidebar to manage <Link href="/users">users</Link>, review{" "}
          <Link href="/groups">groups</Link>, manage{" "}
          <Link href="/enterprises">enterprises</Link>, open the{" "}
          <Link href="/audits">audit log</Link>, or perform a{" "}
          <Link href="/messages">message inspection</Link> (a justification
          reason is required and recorded in the audit log).
        </p>
      </div>
    </AdminShell>
  );
}
