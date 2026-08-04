"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { backupDrStatus, securityAlertKey, yesNo } from "@/lib/labels";
import { useLocale } from "@/lib/locale";

type BackupSettings = {
  auto_enabled?: boolean;
  interval_hours?: number;
  include_secrets?: boolean;
  updated_at?: string;
};

type BackupJob = {
  running?: boolean;
  kind?: string;
  backup_id?: string;
  mode?: string;
  ok?: boolean;
  message?: string;
  output?: string;
  started_at?: string;
  finished_at?: string;
};

type BackupRow = {
  id?: string;
  manifest?: { encrypted?: boolean; components?: string[]; created_at?: string };
};

type BackupStatus = {
  configured?: boolean;
  ok?: boolean;
  message?: string;
  backup_dir?: string;
  rpo_hours?: number;
  rto_hours?: number;
  latest_age_hours?: number;
  warnings?: string[];
  settings?: BackupSettings;
  job?: BackupJob | null;
  status?: {
    latest?: {
      id?: string;
      encrypted?: boolean;
      errors?: number;
      components?: string[];
    };
    offsite_configured?: boolean;
    latest_drill?: { id?: string; ok?: boolean; excerpt?: string };
  };
  recent?: BackupRow[];
};

export default function BackupPage() {
  const { t } = useLocale();
  const [data, setData] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState(24);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState<"drill" | "production">("drill");
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body = await api<BackupStatus>("/v1/admin/backup/status");
      setData(body);
      if (body.settings) {
        setAutoEnabled(Boolean(body.settings.auto_enabled));
        setIntervalHours(body.settings.interval_hours ?? 24);
        setIncludeSecrets(Boolean(body.settings.include_secrets));
      }
    } catch (e) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.job?.running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [data?.job?.running, load]);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api("/v1/admin/backup/settings", {
        method: "PATCH",
        body: JSON.stringify({
          auto_enabled: autoEnabled,
          interval_hours: intervalHours,
          include_secrets: includeSecrets,
        }),
      });
      setNotice(t("admin.backup.settingsSaved"));
      await load();
    } catch (err) {
      setNotice(formatAdminError(err, t, "admin.err.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function runBackup() {
    setBusy(true);
    setNotice(null);
    try {
      await api("/v1/admin/backup/run", {
        method: "POST",
        body: JSON.stringify({ include_secrets: includeSecrets }),
      });
      setNotice(t("admin.backup.started"));
      await load();
    } catch (err) {
      setNotice(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function runRestore(e: FormEvent) {
    e.preventDefault();
    if (!restoreId) return;
    setBusy(true);
    setNotice(null);
    const modeLabel =
      restoreMode === "production"
        ? t("admin.backup.modeProduction")
        : t("admin.backup.modeDrill");
    try {
      await api("/v1/admin/backup/restore", {
        method: "POST",
        body: JSON.stringify({
          backup_id: restoreId,
          mode: restoreMode,
          confirm: restoreMode === "production" ? restoreConfirm : undefined,
          reason: restoreReason,
          include_secrets: includeSecrets,
        }),
      });
      setNotice(t("admin.backup.restoreStarted", { mode: modeLabel, id: restoreId }));
      setRestoreId(null);
      setRestoreReason("");
      setRestoreConfirm("");
      await load();
    } catch (err) {
      setNotice(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  const latest = data?.status?.latest;
  const job = data?.job;
  const recent = data?.recent ?? [];
  const age =
    typeof data?.latest_age_hours === "number"
      ? `${data.latest_age_hours.toFixed(1)}h`
      : "—";
  const jobRunning = Boolean(job?.running);

  const jobState = job?.running
    ? t("admin.common.running")
    : job?.ok
      ? t("admin.common.done")
      : t("admin.common.failed");

  return (
    <AdminShell>
      <h1>{t("admin.nav.backup")}</h1>
      <div className="page-sub">
        {t("admin.backup.subtitle", {
          rpo: data?.settings?.interval_hours ?? 24,
          rto: data?.rto_hours ?? 4,
        })}
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">{backupDrStatus(t, data)}</div>
          <div className="k">{t("admin.backup.drStatus")}</div>
        </div>
        <div className="stat-card">
          <div className="v">{age}</div>
          <div className="k">{t("admin.backup.latestAge")}</div>
        </div>
        <div className="stat-card">
          <div className="v">{yesNo(t, Boolean(latest?.encrypted))}</div>
          <div className="k">{t("admin.backup.encrypted")}</div>
        </div>
        <div className="stat-card">
          <div className="v">{jobRunning ? job?.kind || "…" : t("admin.common.idle")}</div>
          <div className="k">{t("admin.backup.job")}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("admin.backup.scheduleTitle")}</h2>
        <form onSubmit={saveSettings} className="form-rows">
          <div className="form-row">
            <label htmlFor="backup-auto">{t("admin.backup.auto")}</label>
            <input
              id="backup-auto"
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="backup-interval">{t("admin.backup.interval")}</label>
            <input
              id="backup-interval"
              type="number"
              min={1}
              max={168}
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label htmlFor="backup-secrets">{t("admin.backup.includeSecrets")}</label>
            <input
              id="backup-secrets"
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
          </div>
          <div className="form-row">
            <span />
            <button className="btn" type="submit" disabled={busy || jobRunning}>
              {t("admin.backup.saveSettings")}
            </button>
          </div>
        </form>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button
            className="btn"
            type="button"
            disabled={busy || jobRunning}
            onClick={() => void runBackup()}
          >
            {jobRunning && job?.kind === "backup"
              ? t("admin.backup.backingUp")
              : t("admin.backup.runNow")}
          </button>
          <button type="button" disabled={busy} onClick={() => void load()}>
            {busy ? t("admin.common.refreshing") : t("admin.common.refresh")}
          </button>
        </div>
      </div>

      {job && (job.running || job.message) ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>{t("admin.backup.currentJob")}</strong>
          <p className="muted">
            {job.kind} {job.backup_id ? `· ${job.backup_id}` : ""}{" "}
            {job.mode ? `· ${job.mode}` : ""} · {jobState}
          </p>
          {job.message ? <p className="muted">{job.message}</p> : null}
          {job.output ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 12,
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {job.output}
            </pre>
          ) : null}
        </div>
      ) : null}

      {(data?.warnings || []).length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>{t("admin.common.warnings")}</strong>
          <ul>
            {(data?.warnings || []).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <strong>{t("admin.backup.restoreTitle")}</strong>
        <p className="muted">{t("admin.backup.restoreBlurb")}</p>
        {restoreId ? (
          <form onSubmit={runRestore} className="form-rows" style={{ marginTop: 8 }}>
            <p>
              {t("admin.backup.restoreTarget")} <strong>{restoreId}</strong>
            </p>
            <div className="form-row">
              <label htmlFor="restore-mode">{t("admin.common.mode")}</label>
              <select
                id="restore-mode"
                value={restoreMode}
                onChange={(e) => setRestoreMode(e.target.value as "drill" | "production")}
              >
                <option value="drill">{t("admin.backup.modeDrill")}</option>
                <option value="production">{t("admin.backup.modeProduction")}</option>
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="restore-reason">{t("admin.backup.reasonAudited")}</label>
              <input
                id="restore-reason"
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                placeholder={t("admin.backup.reasonPlaceholder")}
                required
              />
            </div>
            {restoreMode === "production" ? (
              <div className="form-row">
                <label htmlFor="restore-confirm">{t("admin.backup.typeRestore")}</label>
                <input
                  id="restore-confirm"
                  value={restoreConfirm}
                  onChange={(e) => setRestoreConfirm(e.target.value)}
                  placeholder="RESTORE"
                  required
                />
              </div>
            ) : null}
            <div className="form-row">
              <span />
              <button className="btn" type="submit" disabled={busy || jobRunning}>
                {t("admin.backup.startRestore")}
              </button>
              <button type="button" onClick={() => setRestoreId(null)}>
                {t("admin.common.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">{t("admin.backup.chooseBackup")}</p>
        )}
      </div>

      {recent.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>{t("admin.backup.backupsTitle")}</strong>
          <table className="data-table" style={{ width: "100%", marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t("admin.backup.id")}</th>
                <th>{t("admin.backup.components")}</th>
                <th>{t("admin.backup.encrypted")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{(r.manifest?.components || []).join(", ") || "—"}</td>
                  <td>{yesNo(t, Boolean(r.manifest?.encrypted))}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={jobRunning}
                      onClick={() => {
                        setRestoreId(r.id || null);
                        setRestoreMode("drill");
                      }}
                    >
                      {t("admin.backup.restoreBtn")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted">{t("admin.backup.noBackups")}</p>
        </div>
      )}

      <p className="muted" style={{ marginTop: 16 }}>
        {t("admin.backup.backupDir")} {data?.backup_dir || "—"}
      </p>
    </AdminShell>
  );
}
