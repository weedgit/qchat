"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api } from "@/lib/api";

type MFAStatus = {
  mfa_active?: boolean;
  configured?: boolean;
};

export default function SecurityPage() {
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<MFAStatus>("/v1/me/mfa");
      setStatus(s);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const active = Boolean(status?.mfa_active);

  return (
    <AdminShell>
      <h1>Security</h1>
      <div className="page-sub">Administrator multi-factor authentication (TOTP)</div>

      <div className="card" style={{ maxWidth: 560 }}>
        <p>
          Status:{" "}
          <strong>{active ? "Enabled" : "Disabled"}</strong>
        </p>
        <p className="muted">
          When enabled, signing in to the admin console requires a 6-digit code from an
          authenticator app (Google Authenticator, 1Password, etc.). Password reset by
          another admin also clears MFA as a recovery path.
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
    </AdminShell>
  );
}
