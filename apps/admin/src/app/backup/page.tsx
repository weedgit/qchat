"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AdminTime } from "@/components/AdminTime";
import { StableLabelButton } from "@/components/StableLabelButton";
import { api } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { backupDrStatus, yesNo } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";
import { parseBackupStamp } from "@/lib/formatTime";

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
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [data, setData] = useState<BackupStatus | null>(null);
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
    try {
      const body = await api<BackupStatus>("/v1/admin/backup/status");
      setData(body);
      if (body.settings) {
        setAutoEnabled(Boolean(body.settings.auto_enabled));
        setIntervalHours(body.settings.interval_hours ?? 24);
        setIncludeSecrets(Boolean(body.settings.include_secrets));
      }
    } catch (e) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [t, toast]);

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
    try {
      await api("/v1/admin/backup/settings", {
        method: "PATCH",
        body: JSON.stringify({
          auto_enabled: autoEnabled,
          interval_hours: intervalHours,
          include_secrets: includeSecrets,
        }),
      });
      toast.success(t("admin.backup.settingsSaved"));
      await load();
    } catch (err) {
      toast.error(formatAdminError(err, t, "admin.err.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function runBackup() {
    setBusy(true);
    try {
      await api("/v1/admin/backup/run", {
        method: "POST",
        body: JSON.stringify({ include_secrets: includeSecrets }),
      });
      toast.success(t("admin.backup.started"));
      await load();
    } catch (err) {
      toast.error(formatAdminError(err, t, "admin.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function runRestore(e: FormEvent) {
    e.preventDefault();
    if (!restoreId) return;
    setBusy(true);
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
      toast.success(t("admin.backup.restoreStarted", { mode: modeLabel, id: restoreId }));
      setRestoreId(null);
      setRestoreReason("");
      setRestoreConfirm("");
      await load();
    } catch (err) {
      toast.error(formatAdminError(err, t, "admin.err.generic"));
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
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>{t("admin.backup.scheduleTitle")}</h2>
        <form onSubmit={saveSettings}>
          <div className="backup-settings-row">
            <label className="backup-inline-option" htmlFor="backup-auto">
              <input
                id="backup-auto"
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
              />
              <span>{t("admin.backup.auto")}</span>
            </label>
            <label className="backup-inline-option" htmlFor="backup-interval">
              <span>{t("admin.backup.interval")}</span>
              <input
                id="backup-interval"
                type="number"
                min={1}
                max={168}
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value))}
              />
            </label>
            <label className="backup-inline-option" htmlFor="backup-secrets">
              <input
                id="backup-secrets"
                type="checkbox"
                checked={includeSecrets}
                onChange={(e) => setIncludeSecrets(e.target.checked)}
              />
              <span>{t("admin.backup.includeSecrets")}</span>
            </label>
            <button className="btn" type="submit" disabled={busy || jobRunning}>
              {t("admin.backup.saveSettings")}
            </button>
            <StableLabelButton
              label={
                jobRunning && job?.kind === "backup"
                  ? t("admin.backup.backingUp")
                  : t("admin.backup.runNow")
              }
              widthLabels={[t("admin.backup.runNow"), t("admin.backup.backingUp")]}
              disabled={busy || jobRunning}
              onClick={() => void runBackup()}
            />
            <StableLabelButton
              className="btn-secondary"
              label={busy ? t("admin.common.refreshing") : t("admin.common.refresh")}
              widthLabels={[t("admin.common.refresh"), t("admin.common.refreshing")]}
              disabled={busy}
              onClick={() => void load()}
            />
          </div>
        </form>
        <dl className="backup-action-hints">
          <dt>{t("admin.backup.runNow")}</dt>
          <dd>{t("admin.backup.runNowHint")}</dd>
          <dt>{t("admin.common.refresh")}</dt>
          <dd>{t("admin.backup.refreshHint")}</dd>
        </dl>
      </div>

      <div className="backup-panels-grid">
        <div className="card backup-panel-card">
          <h2>{t("admin.backup.backupsTitle")}</h2>
          {recent.length > 0 ? (
            <>
              {restoreId ? (
                <form onSubmit={runRestore} className="form-rows" style={{ marginTop: 12 }}>
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
                    <button className="btn btn-secondary" type="button" onClick={() => setRestoreId(null)}>
                      {t("admin.common.cancel")}
                    </button>
                  </div>
                </form>
              ) : null}
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("admin.common.time")}</th>
                      <th>{t("admin.backup.id")}</th>
                      <th>{t("admin.backup.components")}</th>
                      <th>{t("admin.backup.encrypted")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.id}>
                        <td className="muted">
                          <AdminTime
                            value={parseBackupStamp(r.manifest?.created_at ?? r.id)}
                            resolved={resolved}
                          />
                        </td>
                        <td style={{ fontFamily: "monospace", fontSize: 16 }}>{r.id}</td>
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
            </>
          ) : (
            <p className="muted">{t("admin.backup.noBackups")}</p>
          )}
        </div>

        <div className="card backup-panel-card">
          <h2>{t("admin.backup.currentJob")}</h2>
          {job && (job.running || job.message || job.output) ? (
            <>
              <p className="muted backup-job-meta">
                {job.kind || "—"}
                {job.backup_id ? ` · ${job.backup_id}` : ""}
                {job.mode ? ` · ${job.mode}` : ""} · {jobState}
              </p>
              {job.message ? <p className="muted backup-job-meta">{job.message}</p> : null}
              {job.output ? <pre className="backup-job-log">{job.output}</pre> : null}
            </>
          ) : (
            <p className="muted">{t("admin.backup.noJobOutput")}</p>
          )}

          {(data?.warnings || []).length > 0 ? (
            <div className="backup-warnings-block">
              <strong>{t("admin.common.warnings")}</strong>
              <ul>
                {(data?.warnings || []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        {t("admin.backup.backupDir")} {data?.backup_dir || "—"}
      </p>
    </AdminShell>
  );
}
