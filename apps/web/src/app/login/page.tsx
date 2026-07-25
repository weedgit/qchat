"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingSplash from "@/components/LoadingSplash";
import { ApiError, api, getToken, restoreDesktopSession, setTokens } from "@/lib/api";
import { getAuthDevice } from "@/lib/device";

interface CaptchaState {
  id: string;
  image: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
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
  const [checkingSession, setCheckingSession] = useState(true);
  /** Keep splash up through navigation so desktop never flashes an empty black window. */
  const [enteringApp, setEnteringApp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = (await restoreDesktopSession()) || Boolean(getToken());
      if (cancelled) return;
      if (ok) {
        setEnteringApp(true);
        router.replace("/");
        return;
      }
      try {
        const reason = sessionStorage.getItem("qchat.session_revoked");
        if (reason) {
          sessionStorage.removeItem("qchat.session_revoked");
          setError(
            reason === "banned"
              ? "Your account was banned. Contact an administrator."
              : "Signed out — another device of this type signed in."
          );
        }
      } catch {
        /* ignore */
      }
      setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
      const image = String(data?.image ?? "").trim();
      if (!id || !image.startsWith("data:image/")) {
        throw new Error("empty captcha from server");
      }
      setCaptcha({ id, image });
      setCaptchaStatus("ready");
    } catch (e: any) {
      setCaptcha(null);
      setCaptchaStatus("error");
      const msg =
        e?.name === "AbortError"
          ? "Captcha timed out — try again later"
          : `Captcha unavailable: ${e.message || "network error"}`;
      setError(msg);
    }
  }, []);

  useEffect(() => {
    if (checkingSession) return;
    loadCaptcha();
  }, [loadCaptcha, checkingSession]);

  async function sendRegisterOTP() {
    setSmsBusy(true);
    setError(null);
    setSmsHint(null);
    try {
      const data = await api<any>("/v1/auth/register/otp", {
        method: "POST",
        body: JSON.stringify({
          phone,
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
      const device = await getAuthDevice();
      const payload: Record<string, any> = {
        phone,
        password,
        captcha_id: captcha?.id ?? "",
        captcha: captchaCode,
        device_type: device.deviceType,
        device_name: device.deviceName,
        device_id: device.deviceId,
        platform: device.platform,
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
      setEnteringApp(true);
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

  if (checkingSession || enteringApp) {
    return <LoadingSplash label={enteringApp ? "Opening chat" : "Starting Qchat"} />;
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-logo">Q</div>
        <div className="auth-title">
          {mode === "login" ? "Sign in to Qchat" : "Create your account"}
        </div>
        <div className="auth-sub">
          {mode === "login"
            ? "Secure enterprise messaging"
            : "After signing up, use Join a company in chat to enter with an invite code"}
        </div>

        <div className="field">
          <label>Phone (11 digits)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="13800000002"
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
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (mode !== "register") return;
                e.preventDefault();
                if (!smsBusy && phone && captchaCode) sendRegisterOTP();
              }}
              placeholder="ENTER CODE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            <div
              className={`captcha-image-wrap ${captchaStatus === "error" ? "error" : ""}`}
              aria-label="Captcha image"
            >
              {captchaStatus === "loading" && <span className="captcha-image-fallback">…</span>}
              {captchaStatus === "error" && (
                <span className="captcha-image-fallback">Unavailable</span>
              )}
              {captchaStatus === "ready" && captcha?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="captcha-image" src={captcha.image} alt="Captcha" draggable={false} />
              ) : null}
            </div>
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
