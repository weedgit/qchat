"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { ApiError, api, asList } from "@/lib/api";

type MFAStatus = {
  mfa_active?: boolean;
  configured?: boolean;
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

export default function SecurityPage() {
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
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
  }, [load, loadAllowlist, loadAlerts]);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api<any>("/v1/me/mfa/setup", { method: "POST", body: "{}" });
      setSecret(String(res?.secret ?? ""));
      setOtpauth(String(res?.otpauth_uri ?? ""));
      setInfo("Add this secret in your authenticator app, then enter a code to activate.");
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
      await api("/v1/me/mfa/activate", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setSecret(null);
      setOtpauth(null);
      setCode("");
      setInfo("MFA is now enabled for this administrator account.");
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
      setInfo("MFA disabled.");
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

  return (
    <AdminShell>
      <h1>Security</h1>
      <div className="page-sub">Administrator MFA and IP allowlists</div>

      <div className="card" style={{ maxWidth: 560, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Multi-factor authentication</h2>
        <p>
          Status: <strong>{active ? "Enabled" : "Disabled"}</strong>
        </p>
        <p className="muted">
          When enabled, signing in to the admin console requires a 6-digit code from an
          authenticator app. Password reset by another admin also clears MFA as a recovery path.
        </p>

        {!active && !secret ? (
          <button className="btn" type="button" disabled={busy} onClick={startSetup}>
            Set up MFA
          </button>
        ) : null}

        {secret ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Secret (enter manually in your app)
              </div>
              <code style={{ wordBreak: "break-all" }}>{secret}</code>
            </div>
            {otpauth ? (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  otpauth URI
                </div>
                <code style={{ wordBreak: "break-all", fontSize: 12 }}>{otpauth}</code>
              </div>
            ) : null}
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
              <span>Current authenticator code</span>
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
              onClick={disable}
            >
              Disable MFA
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            value={cidrInput}
            onChange={(e) => setCidrInput(e.target.value)}
            placeholder="10.0.0.0/8 or 203.0.113.10"
            style={{ flex: "1 1 180px" }}
          />
          <input
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="Label (optional)"
            style={{ flex: "1 1 120px" }}
          />
          <button
            className="btn"
            type="button"
            disabled={busy || !cidrInput.trim()}
            onClick={addCIDR}
          >
            Add
          </button>
        </div>

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
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => removeCIDR(e.id)}
                >
                  Remove
                </button>
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
          the IP allowlist blocks a login. These do not send email or SMS.
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
