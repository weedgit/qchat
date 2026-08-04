"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import AdminShell from "@/components/AdminShell";
import { AdminTime } from "@/components/AdminTime";
import Pagination from "@/components/Pagination";
import { api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { securityAlertLabel } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";
import { can } from "@/lib/rbac";

const ALERTS_PAGE_SIZE = 10;

type MFAStatus = {
  mfa_active?: boolean;
  configured?: boolean;
  recovery_codes_remaining?: number;
};

type AllowEntry = {
  id: string;
  cidr: string;
  label?: string;
};

type LoginAlert = {
  id: string;
  action: string;
  ip: string;
  username: string;
  displayName: string;
  createdAt: string;
};

function asCodeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => String(c ?? "").trim()).filter(Boolean);
}

export default function SecurityPage() {
  const { t, resolved } = useLocale();
  const toast = useToast();
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<AllowEntry[]>([]);
  const [enforced, setEnforced] = useState(false);
  const [cidrInput, setCidrInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [alerts, setAlerts] = useState<LoginAlert[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsOffset, setAlertsOffset] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertIp, setAlertIp] = useState("");
  const [alertFrom, setAlertFrom] = useState("");
  const [alertTo, setAlertTo] = useState("");
  const [meRole, setMeRole] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await api<MFAStatus>("/v1/me/mfa");
      setStatus(s);
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    }
  }, [t, toast]);

  const loadAllowlist = useCallback(async () => {
    try {
      const body = await api<any>("/v1/admin/security/ip-allowlist");
      setEnforced(Boolean(body?.enforced));
      setEntries(
        asList(body, "entries")
          .map((e: any) => ({
            id: String(e?.id ?? ""),
            cidr: String(e?.cidr ?? ""),
            label: String(e?.label ?? ""),
          }))
          .filter((e: AllowEntry) => e.id)
      );
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    }
  }, [t, toast]);

  const loadAlerts = useCallback(
    async (ip: string, from: string, to: string, off: number) => {
      setAlertsLoading(true);
      try {
        const qs = new URLSearchParams({
          limit: String(ALERTS_PAGE_SIZE),
          offset: String(off),
        });
        if (ip.trim()) qs.set("ip", ip.trim());
        if (from.trim()) qs.set("from", from.trim());
        if (to.trim()) qs.set("to", to.trim());
        const body = await api<any>(`/v1/admin/security/login-alerts?${qs.toString()}`);
        const allItems = asList(body, "alerts")
          .map((a: any) => ({
            id: String(a?.id ?? ""),
            action: String(a?.action ?? ""),
            ip: String(a?.ip ?? "") || "—",
            username: String(a?.username ?? ""),
            displayName: String(a?.display_name ?? ""),
            createdAt: String(a?.created_at ?? ""),
          }))
          .filter((a: LoginAlert) => a.id);

        const apiTotal = Number(body?.total);
        let total = Number.isFinite(apiTotal) && apiTotal > 0 ? apiTotal : 0;
        let pageItems = allItems;

        if (total > 0 && allItems.length > ALERTS_PAGE_SIZE) {
          total = Math.max(total, allItems.length);
          pageItems = allItems.slice(off, off + ALERTS_PAGE_SIZE);
        } else if (total > 0) {
          pageItems = allItems;
        } else if (allItems.length > ALERTS_PAGE_SIZE) {
          total = allItems.length;
          pageItems = allItems.slice(off, off + ALERTS_PAGE_SIZE);
        } else {
          total = allItems.length;
        }

        setAlerts(pageItems);
        setAlertsTotal(total);
      } catch (e: any) {
        toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
        setAlerts([]);
        setAlertsTotal(0);
      } finally {
        setAlertsLoading(false);
      }
    },
    [t, toast]
  );

  useEffect(() => {
    load();
    loadAllowlist();
    api<any>("/v1/me")
      .then((me) => setMeRole(String(me?.role ?? "")))
      .catch(() => setMeRole(""));
  }, [load, loadAllowlist]);

  useEffect(() => {
    loadAlerts(alertIp, alertFrom, alertTo, alertsOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAlerts, alertsOffset]);

  function onAlertFilter(e: FormEvent) {
    e.preventDefault();
    setAlertsOffset(0);
    void loadAlerts(alertIp, alertFrom, alertTo, 0);
  }

  useEffect(() => {
    if (!otpauth) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(otpauth, {
      width: 180,
      margin: 1,
      color: { dark: "#0e1621", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauth]);

  async function startSetup() {
    setBusy(true);
    setRecoveryCodes(null);
    try {
      const res = await api<any>("/v1/me/mfa/setup", { method: "POST", body: "{}" });
      setSecret(String(res?.secret ?? ""));
      setOtpauth(String(res?.otpauth_uri ?? ""));
      toast.info(t("admin.security.scanToActivate"));
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    try {
      const res = await api<any>("/v1/me/mfa/activate", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      const codes = asCodeList(res?.recovery_codes);
      setSecret(null);
      setOtpauth(null);
      setCode("");
      setRecoveryCodes(codes.length ? codes : null);
      toast.success(
        codes.length ? t("admin.security.mfaEnabledWithCodes") : t("admin.security.mfaEnabled")
      );
      await load();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api("/v1/me/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setCode("");
      setRecoveryCodes(null);
      toast.success(t("admin.security.mfaDisabled"));
      await load();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecovery() {
    setBusy(true);
    try {
      const res = await api<any>("/v1/me/mfa/recovery/regenerate", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      const codes = asCodeList(res?.recovery_codes);
      setCode("");
      setRecoveryCodes(codes.length ? codes : null);
      toast.success(
        codes.length
          ? t("admin.security.recoveryRegenerated")
          : t("admin.security.recoveryRegeneratedShort")
      );
      await load();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addCIDR() {
    setBusy(true);
    try {
      await api("/v1/admin/security/ip-allowlist", {
        method: "POST",
        body: JSON.stringify({ cidr: cidrInput.trim(), label: labelInput.trim() }),
      });
      setCidrInput("");
      setLabelInput("");
      await loadAllowlist();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function removeCIDR(id: string) {
    setBusy(true);
    try {
      await api(`/v1/admin/security/ip-allowlist/${id}`, { method: "DELETE" });
      await loadAllowlist();
    } catch (e: any) {
      toast.error(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  const active = Boolean(status?.mfa_active);
  const remaining = Number(status?.recovery_codes_remaining ?? 0);
  const canWriteSecurity = can(meRole, "writeSecurity");

  return (
    <AdminShell>

      <div className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
        <div className="security-inline-row">
          <h2>{t("admin.security.mfaTitle")}</h2>
          <span>
            {t("admin.security.mfaStatus")}{" "}
            <strong>{active ? t("admin.common.enabled") : t("admin.common.disabled")}</strong>
            {active ? (
              <span className="muted">
                {t("admin.security.recoveryRemaining", { count: remaining })}
              </span>
            ) : null}
          </span>
          {!active && !secret ? (
            <button className="btn" type="button" disabled={busy} onClick={startSetup}>
              {t("admin.security.setupMfa")}
            </button>
          ) : null}
        </div>

        {secret ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {qrDataUrl ? (
              <div>
                <div className="muted" style={{ fontSize: 16, marginBottom: 8 }}>
                  {t("admin.security.scanQr")}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="MFA enrollment QR code"
                  width={180}
                  height={180}
                  style={{ borderRadius: 8, background: "#fff" }}
                />
              </div>
            ) : null}
            <div>
              <div className="muted" style={{ fontSize: 16, marginBottom: 4 }}>
                {t("admin.security.secretManual")}
              </div>
              <code style={{ wordBreak: "break-all" }}>{secret}</code>
            </div>
            <label className="field">
              <span>{t("admin.security.verificationCode")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("admin.security.codePlaceholder")}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy || code.length !== 6}
              onClick={activate}
            >
              {t("admin.security.activateMfa")}
            </button>
          </div>
        ) : null}

        {active ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <label className="field">
              <span>{t("admin.security.mfaCodeLabel")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 16))}
                placeholder={t("admin.login.mfaPlaceholder")}
                autoComplete="one-time-code"
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                disabled={busy || code.trim().length < 6}
                onClick={disable}
              >
                {t("admin.security.disableMfa")}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || !/^\d{6}$/.test(code.trim())}
                onClick={regenerateRecovery}
              >
                {t("admin.security.regenerateRecovery")}
              </button>
            </div>
          </div>
        ) : null}

        {recoveryCodes?.length ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid var(--border, #444)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("admin.security.recoveryTitle")}</div>
            <p className="muted" style={{ marginTop: 0 }}>{t("admin.security.recoveryBlurb")}</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: "ui-monospace, monospace" }}>
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <button
              className="btn"
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => setRecoveryCodes(null)}
            >
              {t("admin.security.recoverySaved")}
            </button>
          </div>
        ) : null}

      </div>

      <div className="security-panels-grid">
        <div className="card security-panel-card">
          <div className="security-panel-header">
            <h2>{t("admin.security.ipTitle")}</h2>
            <span className="security-panel-header-status">
              {t("admin.security.policy")}{" "}
              <strong>
                {enforced ? t("admin.security.policyEnforced") : t("admin.security.policyOff")}
              </strong>
            </span>
          </div>

          {canWriteSecurity ? (
            <form
              className="security-ip-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && cidrInput.trim()) addCIDR();
              }}
            >
              <label className="field" htmlFor="sec-cidr">
                <span>{t("admin.security.cidrLabel")}</span>
                <input
                  id="sec-cidr"
                  value={cidrInput}
                  onChange={(e) => setCidrInput(e.target.value)}
                  placeholder={t("admin.security.cidrPlaceholder")}
                />
              </label>
              <label className="field" htmlFor="sec-label">
                <span>{t("admin.common.label")}</span>
                <input
                  id="sec-label"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder={t("admin.common.optional")}
                />
              </label>
              <button className="btn" type="submit" disabled={busy || !cidrInput.trim()}>
                {t("admin.common.add")}
              </button>
            </form>
          ) : (
            <p className="muted">{t("admin.security.readOnlyRole")}</p>
          )}

          {entries.length === 0 ? (
            <p className="muted">{t("admin.security.noEntries")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {entries.map((e) => (
                <li
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    borderTop: "1px solid var(--border, #333)",
                    paddingTop: 8,
                  }}
                >
                  <div>
                    <code>{e.cidr}</code>
                    {e.label ? <span className="muted"> · {e.label}</span> : null}
                  </div>
                  {canWriteSecurity ? (
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => removeCIDR(e.id)}
                    >
                      {t("admin.common.remove")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card security-panel-card">
          <h2>{t("admin.security.alertsTitle")}</h2>
          <form className="security-alerts-filters" onSubmit={onAlertFilter}>
            <input
              type="date"
              value={alertFrom}
              onChange={(e) => setAlertFrom(e.target.value)}
              aria-label={t("admin.security.filterFrom")}
            />
            <input
              type="date"
              value={alertTo}
              onChange={(e) => setAlertTo(e.target.value)}
              aria-label={t("admin.security.filterTo")}
            />
            <input
              type="text"
              value={alertIp}
              onChange={(e) => setAlertIp(e.target.value)}
              placeholder={t("admin.security.filterIp")}
              aria-label={t("admin.security.filterIp")}
            />
            <button className="btn" type="submit" disabled={alertsLoading}>
              {t("admin.common.search")}
            </button>
          </form>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>{t("admin.security.colEvent")}</th>
                  <th>{t("admin.security.colUser")}</th>
                  <th>{t("admin.security.colIp")}</th>
                  <th>{t("admin.security.colTime")}</th>
                </tr>
              </thead>
              <tbody>
                {alertsLoading && alerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t("admin.common.loading")}
                    </td>
                  </tr>
                ) : null}
                {!alertsLoading && alerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t("admin.security.noAlerts")}
                    </td>
                  </tr>
                ) : null}
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{securityAlertLabel(t, a.action)}</td>
                    <td>{a.displayName || a.username || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 16 }}>{a.ip}</td>
                    <td className="muted">
                      <AdminTime value={a.createdAt} resolved={resolved} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            total={alertsTotal}
            offset={alertsOffset}
            pageSize={ALERTS_PAGE_SIZE}
            visibleCount={alerts.length}
            loading={alertsLoading}
            onPageChange={setAlertsOffset}
          />
        </div>
      </div>
    </AdminShell>
  );
}
