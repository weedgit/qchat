"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import AdminShell from "@/components/AdminShell";
import { ApiError, api, asList } from "@/lib/api";
import { formatAdminError } from "@/lib/errors";
import { securityAlertLabel } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { can } from "@/lib/rbac";

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
  const { t } = useLocale();
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [entries, setEntries] = useState<AllowEntry[]>([]);
  const [enforced, setEnforced] = useState(false);
  const [cidrInput, setCidrInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [ipError, setIpError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<LoginAlert[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [meRole, setMeRole] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<MFAStatus>("/v1/me/mfa");
      setStatus(s);
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
    }
  }, [t]);

  const loadAllowlist = useCallback(async () => {
    setIpError(null);
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
      setIpError(formatAdminError(e, t, "admin.err.loadFailed"));
    }
  }, [t]);

  const loadAlerts = useCallback(async () => {
    setAlertsError(null);
    try {
      const body = await api<any>("/v1/admin/security/login-alerts");
      setAlerts(
        asList(body, "alerts")
          .map((a: any) => ({
            id: String(a?.id ?? ""),
            action: String(a?.action ?? ""),
            ip: String(a?.ip ?? "") || "—",
            username: String(a?.username ?? ""),
            displayName: String(a?.display_name ?? ""),
            createdAt: String(a?.created_at ?? ""),
          }))
          .filter((a: LoginAlert) => a.id)
      );
    } catch (e: any) {
      setAlertsError(formatAdminError(e, t, "admin.err.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    load();
    loadAllowlist();
    loadAlerts();
    api<any>("/v1/me")
      .then((me) => setMeRole(String(me?.role ?? "")))
      .catch(() => setMeRole(""));
  }, [load, loadAllowlist, loadAlerts]);

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
    setError(null);
    setInfo(null);
    setRecoveryCodes(null);
    try {
      const res = await api<any>("/v1/me/mfa/setup", { method: "POST", body: "{}" });
      setSecret(String(res?.secret ?? ""));
      setOtpauth(String(res?.otpauth_uri ?? ""));
      setInfo(t("admin.security.scanToActivate"));
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setError(null);
    setInfo(null);
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
      setInfo(
        codes.length ? t("admin.security.mfaEnabledWithCodes") : t("admin.security.mfaEnabled")
      );
      await load();
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api("/v1/me/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setCode("");
      setRecoveryCodes(null);
      setInfo(t("admin.security.mfaDisabled"));
      await load();
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecovery() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api<any>("/v1/me/mfa/recovery/regenerate", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      const codes = asCodeList(res?.recovery_codes);
      setCode("");
      setRecoveryCodes(codes.length ? codes : null);
      setInfo(
        codes.length
          ? t("admin.security.recoveryRegenerated")
          : t("admin.security.recoveryRegeneratedShort")
      );
      await load();
    } catch (e: any) {
      setError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addCIDR() {
    setBusy(true);
    setIpError(null);
    try {
      await api("/v1/admin/security/ip-allowlist", {
        method: "POST",
        body: JSON.stringify({ cidr: cidrInput.trim(), label: labelInput.trim() }),
      });
      setCidrInput("");
      setLabelInput("");
      await loadAllowlist();
    } catch (e: any) {
      setIpError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function removeCIDR(id: string) {
    setBusy(true);
    setIpError(null);
    try {
      await api(`/v1/admin/security/ip-allowlist/${id}`, { method: "DELETE" });
      await loadAllowlist();
    } catch (e: any) {
      setIpError(formatAdminError(e, t, "admin.err.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  const active = Boolean(status?.mfa_active);
  const remaining = Number(status?.recovery_codes_remaining ?? 0);
  const canWriteSecurity = can(meRole, "writeSecurity");

  return (
    <AdminShell>
      <h1>{t("admin.nav.security")}</h1>
      <div className="page-sub">{t("admin.security.subtitle")}</div>

      <div className="card" style={{ maxWidth: 560, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("admin.security.mfaTitle")}</h2>
        <p>
          {t("admin.security.mfaStatus")}{" "}
          <strong>{active ? t("admin.common.enabled") : t("admin.common.disabled")}</strong>
          {active ? (
            <span className="muted">
              {t("admin.security.recoveryRemaining", { count: remaining })}
            </span>
          ) : null}
        </p>
        <p className="muted">{t("admin.security.mfaBlurb")}</p>

        {!active && !secret ? (
          <button className="btn" type="button" disabled={busy} onClick={startSetup}>
            {t("admin.security.setupMfa")}
          </button>
        ) : null}

        {secret ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {qrDataUrl ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
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
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
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

        {error ? <div className="error-text" style={{ marginTop: 12 }}>{error}</div> : null}
        {info ? <div className="muted" style={{ marginTop: 12 }}>{info}</div> : null}
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("admin.security.ipTitle")}</h2>
        <p>
          {t("admin.security.policy")}{" "}
          <strong>
            {enforced ? t("admin.security.policyEnforced") : t("admin.security.policyOff")}
          </strong>
        </p>
        <p className="muted">{t("admin.security.ipBlurb")}</p>

        {canWriteSecurity ? (
          <div className="form-rows" style={{ maxWidth: "100%", marginBottom: 12 }}>
            <div className="form-row">
              <label htmlFor="sec-cidr">{t("admin.security.cidrLabel")}</label>
              <input
                id="sec-cidr"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder={t("admin.security.cidrPlaceholder")}
              />
            </div>
            <div className="form-row">
              <label htmlFor="sec-label">{t("admin.common.label")}</label>
              <input
                id="sec-label"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder={t("admin.common.optional")}
              />
            </div>
            <div className="form-row">
              <span />
              <button
                className="btn"
                type="button"
                disabled={busy || !cidrInput.trim()}
                onClick={addCIDR}
                style={{ justifySelf: "start" }}
              >
                {t("admin.common.add")}
              </button>
            </div>
          </div>
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
        {ipError ? <div className="error-text" style={{ marginTop: 12 }}>{ipError}</div> : null}
      </div>

      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("admin.security.alertsTitle")}</h2>
        <p className="muted">{t("admin.security.alertsBlurb")}</p>
        {alertsError ? <div className="error-text">{alertsError}</div> : null}
        {alerts.length === 0 && !alertsError ? (
          <p className="muted">{t("admin.security.noAlerts")}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {alerts.map((a) => (
              <li
                key={a.id}
                style={{
                  borderTop: "1px solid var(--border, #333)",
                  paddingTop: 8,
                  fontSize: 13,
                }}
              >
                <strong>{securityAlertLabel(t, a.action)}</strong>
                <span className="muted">
                  {" "}
                  · {a.displayName || a.username || "admin"} · {a.ip}
                </span>
                <div className="muted">{a.createdAt}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
