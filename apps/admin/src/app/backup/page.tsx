"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api } from "@/lib/api";

type BackupStatus = {
  configured?: boolean;
  ok?: boolean;
  message?: string;
  backup_dir?: string;
  rpo_hours?: number;
  rto_hours?: number;
  latest_age_hours?: number;
  warnings?: string[];
  status?: {
    latest?: {
      id?: string;
      created_at?: string;
      encrypted?: boolean;
      errors?: number;
      components?: string[];
      path?: string;
    };
    offsite_configured?: boolean;
    encryption_configured?: boolean;
    latest_drill?: {
      id?: string;
      ok?: boolean;
      path?: string;
      excerpt?: string;
    };
    recent?: Array<{ id?: string }>;
  };
  recent?: Array<{ id?: string }>;
};

export default function BackupPage() {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body = await api<BackupStatus>("/v1/admin/backup/status");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = data?.status?.latest;
  const drill = data?.status?.latest_drill;
  const recent = data?.status?.recent ?? data?.recent ?? [];
  const age =
    typeof data?.latest_age_hours === "number"
      ? `${data.latest_age_hours.toFixed(1)}h`
      : "—";

  return (
    <AdminShell>
      <h1>Backup & recovery</h1>
      <div className="page-sub">
        Customized backup for server failure (RPO ≤ {data?.rpo_hours ?? 24}h ·
        RTO ≤ {data?.rto_hours ?? 4}h)
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">
            {data == null ? "—" : data.ok ? "OK" : data.configured ? "Warn" : "None"}
          </div>
          <div className="k">DR status</div>
        </div>
        <div className="stat-card">
          <div className="v">{age}</div>
          <div className="k">Latest backup age</div>
        </div>
        <div className="stat-card">
          <div className="v">{latest?.encrypted ? "Yes" : "No"}</div>
          <div className="k">Encrypted</div>
        </div>
        <div className="stat-card">
          <div className="v">{data?.status?.offsite_configured ? "Yes" : "No"}</div>
          <div className="k">Off-site configured</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <strong>Latest backup</strong>
          <button type="button" disabled={busy} onClick={() => void load()}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {data?.message ? <p className="muted">{data.message}</p> : null}
        {latest ? (
          <ul className="muted" style={{ marginTop: 8 }}>
            <li>Id: {latest.id}</li>
            <li>Components: {(latest.components || []).join(", ") || "—"}</li>
            <li>Errors: {latest.errors ?? 0}</li>
            <li>Path: {latest.path || "—"}</li>
          </ul>
        ) : (
          <p className="muted">No backup recorded yet. Run ./deploy/backup.sh</p>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          Backup dir: {data?.backup_dir || "—"}
        </p>
      </div>

      {(data?.warnings || []).length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>Warnings</strong>
          <ul>
            {(data?.warnings || []).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <strong>Latest restore drill</strong>
        {drill ? (
          <>
            <p className="muted">
              {drill.id} · {drill.ok ? "passed" : "failed"}
            </p>
            {drill.excerpt ? (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                  marginTop: 8,
                  maxHeight: 240,
                  overflow: "auto",
                }}
              >
                {drill.excerpt}
              </pre>
            ) : null}
          </>
        ) : (
          <p className="muted">No drill report. Run ./deploy/restore_drill.sh</p>
        )}
      </div>

      {recent.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>Recent backups</strong>
          <ul className="muted">
            {recent.map((r) => (
              <li key={r.id}>{r.id}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </AdminShell>
  );
}
