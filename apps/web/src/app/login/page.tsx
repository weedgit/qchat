"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, setTokens } from "@/lib/api";
import { getAuthDevice } from "@/lib/device";

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
  const [captchaStatus, setCaptchaStatus] = useState<"loading" | "ready" | "error">("loading");
  const [smsCode, setSmsCode] = useState("");
  const [smsChallengeId, setSmsChallengeId] = useState("");
  const [smsHint, setSmsHint] = useState<string | null>(null);
  const [smsBusy, setSmsBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCaptcha = useCallback(async () => {
    setCaptcha(null);
    setCaptchaStatus("loading");
    try {
      let data: any;
      // In Electron, fetch captcha via main process (avoids renderer/network quirks).
      if (typeof window !== "undefined" && window.qchatDesktop?.fetchCaptcha) {
        data = await window.qchatDesktop.fetchCaptcha();
      } else {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 10000);
        data = await api<any>("/v1/auth/captcha", { signal: ctrl.signal });
        window.clearTimeout(timer);
      }
      const id = String(data?.captcha_id ?? data?.id ?? "");
      const challenge = String(data?.challenge ?? "").trim();
      if (!id || !challenge) {
        throw new Error("empty captcha from server");
      }
      setCaptcha({ id, challenge });
      setCaptchaStatus("ready");
    } catch (e: any) {
      setCaptcha(null);
      setCaptchaStatus("error");
      const msg =
        e?.name === "AbortError"
          ? "Captcha timed out — click the box to retry"
          : `Captcha unavailable: ${e.message || "network error"}`;
      setError(msg);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  async function sendRegisterOTP() {
    setSmsBusy(true);
    setError(null);
    setSmsHint(null);
    try {
      const data = await api<any>("/v1/auth/register/otp", {
        method: "POST",
        body: JSON.stringify({
          phone,
          invite_code: inviteCode,
          captcha_id: captcha?.id ?? "",
          captcha: captchaCode,
        }),
      });
      setSmsChallengeId(String(data?.challenge_id ?? ""));
      if (data?.dev_code) {
        setSmsHint(`Dev SMS code: ${data.dev_code}`);
        setSmsCode(String(data.dev_code));
      } else {
        setSmsHint("SMS code sent. Enter it below.");
      }
      setCaptchaCode("");
      await loadCaptcha();
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
      setSmsBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = getAuthDevice();
      const payload: Record<string, any> = {
        phone,
        password,
        invite_code: inviteCode,
        captcha_id: captcha?.id ?? "",
        captcha: captchaCode,
        device_type: device.deviceType,
        device_name: device.deviceName,
        device_id: device.deviceId,
      };
      if (mode === "register") {
        payload.username = username || `user_${phone.slice(-4)}`;
        payload.sms_challenge_id = smsChallengeId;
        payload.sms_code = smsCode;
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
              className="captcha-input"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
              placeholder="ENTER CODE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            <button
              type="button"
              className={`captcha-placeholder ${captchaStatus === "error" ? "error" : ""}`}
              onClick={() => {
                setError(null);
                loadCaptcha();
              }}
              title="Click to refresh captcha"
            >
              {captchaStatus === "loading" && "…"}
              {captchaStatus === "error" && "Retry"}
              {captchaStatus === "ready" && (captcha?.challenge || "Retry")}
            </button>
          </div>
        </div>

        {mode === "register" && (
          <div className="field">
            <label>SMS verification</label>
            <div className="captcha-row">
              <input
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value)}
                placeholder="SMS code"
                required
              />
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: "8px 12px", borderRadius: 8, whiteSpace: "nowrap" }}
                disabled={smsBusy || !phone || !captchaCode}
                onClick={sendRegisterOTP}
              >
                {smsBusy ? "Sending…" : "Send SMS"}
              </button>
            </div>
            {smsHint && <div className="auth-sub" style={{ marginTop: 6 }}>{smsHint}</div>}
          </div>
        )}

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
              setSmsCode("");
              setSmsChallengeId("");
              setSmsHint(null);
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
