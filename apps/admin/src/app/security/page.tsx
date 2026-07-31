"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import AdminShell from "@/components/AdminShell";
import { ApiError, api, asList } from "@/lib/api";
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

function alertLabel(action: string): string {
  switch (action) {
    case "admin.login_new_device":
      return "New device";
    case "admin.login_new_ip":
      return "New IP address";
    case "user.login_denied_ip":
      return "IP allowlist blocked login";
    default:
      return action;
  }
}

function asCodeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => String(c ?? "").trim()).filter(Boolean);
}

export default function SecurityPage() {
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
      setError(e.message);
    }
  }, []);

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
      setIpError(e.message);
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    setAlertsError(null);
    try {
      const body = await api<any>("/v1/admin/security/login-alerts");
      setAlerts(
        asList(body, "alerts").map((a: any) => ({
          id: String(a?.id ?? ""),
          action: String(a?.action ?? ""),
          ip: String(a?.ip ?? "") || "—",
          username: String(a?.username ?? ""),
          displayName: String(a?.display_name ?? ""),
          createdAt: String(a?.created_at ?? ""),
        })).filter((a: LoginAlert) => a.id)
      );
    } catch (e: any) {
      setAlertsError(e.message);
    }
  }, []);

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
      setInfo("Scan the QR code (or enter the secret), then enter a code to activate.");
    } catch (e: any) {
      setError(e.message);
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
        codes.length
          ? "MFA enabled. Store these recovery codes now — they are shown only once."
          : "MFA is now enabled for this administrator account."
      );
      await load();
    } catch (e: any) {
      setError(e.message);
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
      setInfo("MFA disabled.");
      await load();
    } catch (e: any) {
      setError(e.message);
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
          ? "New recovery codes issued. Previous unused codes no longer work."
          : "Recovery codes regenerated."
      );
      await load();
    } catch (e: any) {
      setError(e.message);
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
      setIpError(e instanceof ApiError ? e.message : e.message);
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
      setIpError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const active = Boolean(status?.mfa_active);
  const remaining = Number(status?.recovery_codes_remaining ?? 0);
  const canWriteSecurity = can(meRole, "writeSecurity");

  return (
    <AdminShell>
      <h1>Security</h1>
      <div className="page-sub">Administrator MFA and IP allowlists</div>

      <div className="card" style={{ maxWidth: 560, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Multi-factor authentication</h2>
        <p>
          Status: <strong>{active ? "Enabled" : "Disabled"}</strong>
          {active ? (
            <span className="muted">
              {" "}
              · {remaining} recovery code{remaining === 1 ? "" : "s"} remaining
            </span>
          ) : null}
        </p>
        <p className="muted">
          When enabled, signing in requires a 6-digit authenticator code or a one-time recovery
          code. Password reset by another admin also clears MFA.
        </p>

        {!active && !secret ? (
          <button className="btn" type="button" disabled={busy} onClick={startSetup}>
            Set up MFA
          </button>
        ) : null}

        {secret ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {qrDataUrl ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Scan with your authenticator app
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
                Secret (manual entry)
              </div>
              <code style={{ wordBreak: "break-all" }}>{secret}</code>
            </div>
            <label className="field">
              <span>Verification code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
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
              Activate MFA
            </button>
          </div>
        ) : null}

        {active ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <label className="field">
              <span>Authenticator or recovery code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 16))}
                placeholder="6-digit or XXXX-XXXX"
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
                Disable MFA
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || !/^\d{6}$/.test(code.trim())}
                onClick={regenerateRecovery}
              >
                Regenerate recovery codes
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
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Recovery codes (save now)</div>
            <p className="muted" style={{ marginTop: 0 }}>
              Each code works once. Store them offline; they will not be shown again.
            </p>
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
              I have saved these codes
            </button>
          </div>
        ) : null}

        {error ? <div className="error-text" style={{ marginTop: 12 }}>{error}</div> : null}
        {info ? <div className="muted" style={{ marginTop: 12 }}>{info}</div> : null}
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Admin IP allowlist</h2>
        <p>
          Policy: <strong>{enforced ? "Enforced" : "Off (empty list)"}</strong>
        </p>
        <p className="muted">
          When at least one CIDR is listed, administrators in this enterprise may only sign in
          from matching client IPs. Single addresses are stored as /32 (IPv4) or /128 (IPv6).
        </p>

        {canWriteSecurity ? (
          <div className="form-rows" style={{ maxWidth: "100%", marginBottom: 12 }}>
            <div className="form-row">
              <label htmlFor="sec-cidr">CIDR / IP</label>
              <input
                id="sec-cidr"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder="10.0.0.0/8 or 203.0.113.10"
              />
            </div>
            <div className="form-row">
              <label htmlFor="sec-label">Label</label>
              <input
                id="sec-label"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Optional"
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
                Add
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">IP allowlist is read-only for your role.</p>
        )}

        {entries.length === 0 ? (
          <p className="muted">No entries — allowlist disabled.</p>
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
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {ipError ? <div className="error-text" style={{ marginTop: 12 }}>{ipError}</div> : null}
      </div>

      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Login alerts</h2>
        <p className="muted">
          In-console notices when an administrator signs in from a new device or IP, or when
          the IP allowlist blocks a login. These do not send email.
        </p>
        {alertsError ? <div className="error-text">{alertsError}</div> : null}
        {alerts.length === 0 && !alertsError ? (
          <p className="muted">No recent login alerts.</p>
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
                <strong>{alertLabel(a.action)}</strong>
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
