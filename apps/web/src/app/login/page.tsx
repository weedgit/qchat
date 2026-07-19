"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, setTokens } from "@/lib/api";

interface CaptchaState {
  id: string;
  challenge: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("ACME2026");
  const [username, setUsername] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCaptcha = useCallback(async () => {
    setCaptcha(null);
    try {
      const data = await api<any>("/v1/auth/captcha");
      setCaptcha({
        id: String(data?.captcha_id ?? data?.id ?? ""),
        challenge: String(data?.challenge ?? ""),
      });
    } catch (e: any) {
      setError(`Captcha unavailable: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        phone,
        password,
        invite_code: inviteCode,
        captcha_id: captcha?.id ?? "",
        captcha: captchaCode,
        device_type: "desktop",
        device_name: "web",
      };
      if (mode === "register") {
        payload.username = username || `user_${phone.slice(-4)}`;
      } else {
        payload.remember_me = remember;
      }
      const data = await api<any>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("No access_token in response");
      setTokens(String(token), String(data?.refresh_token ?? ""), mode === "register" ? true : remember);
      router.replace("/");
    } catch (e: any) {
      if (e instanceof ApiError && e.fields) {
        const parts = Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`);
        setError(parts.length ? parts.join("; ") : e.message);
      } else {
        setError(e.message);
      }
      setCaptchaCode("");
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-logo">Q</div>
        <div className="auth-title">
          {mode === "login" ? "Sign in to Qchat" : "Create your account"}
        </div>
        <div className="auth-sub">Secure enterprise messaging</div>

        <div className="field">
          <label>Phone (11 digits)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="13800000002"
            required
          />
        </div>

        <div className="field">
          <label>Invite code</label>
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="ACME2026"
            required
          />
        </div>

        {mode === "register" && (
          <div className="field">
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice"
              required
            />
          </div>
        )}

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 8 letters/digits"
            required
          />
        </div>

        <div className="field">
          <label>Captcha</label>
          <div className="captcha-row">
            <input
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              placeholder="Enter code"
              required
            />
            <div className="captcha-placeholder" onClick={loadCaptcha} title="Click to refresh">
              {captcha?.challenge || "…"}
            </div>
          </div>
        </div>

        <div className="remember-row">
          {mode === "login" ? (
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember me (60 days)
            </label>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: "4px 8px", borderRadius: 8 }}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Need an account?" : "Have an account?"}
          </button>
        </div>

        {error && <div className="error-text">{error}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Register"}
        </button>
      </form>
    </div>
  );
}
