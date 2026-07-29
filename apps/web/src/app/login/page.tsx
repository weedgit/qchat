"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoadingSplash from "@/components/LoadingSplash";
import { PasswordInput } from "@/components/PasswordInput";
import { ApiError, api, getToken, restoreDesktopSession, setTokens } from "@/lib/api";
import { isValidPhone, validateLoginCredentials } from "@/lib/credentials";
import { getAuthDevice } from "@/lib/device";
import { isElectronShell } from "@/lib/downloads";
import { useLocale } from "@/lib/locale";

interface CaptchaState {
  id: string;
  image: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
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
  const [showDownload, setShowDownload] = useState(false);

  useEffect(() => {
    setShowDownload(!isElectronShell());
  }, []);

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
      let data: any = null;
      let lastErr: unknown = null;

      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
        new Promise<T>((resolve, reject) => {
          const t = window.setTimeout(
            () => reject(Object.assign(new Error(label), { name: "AbortError" })),
            ms
          );
          p.then(
            (v) => {
              window.clearTimeout(t);
              resolve(v);
            },
            (e) => {
              window.clearTimeout(t);
              reject(e);
            }
          );
        });

      // Desktop IPC can hang on a bad API URL — bound it, then fall back to same-origin fetch.
      if (typeof window !== "undefined" && window.qchatDesktop?.fetchCaptcha) {
        try {
          data = await withTimeout(
            window.qchatDesktop.fetchCaptcha(),
            4000,
            "desktop captcha timed out"
          );
        } catch (e) {
          lastErr = e;
        }
      }
      if (!data) {
        try {
          data = await withTimeout(
            api<any>("/v1/auth/captcha"),
            12000,
            "captcha timed out"
          );
        } catch (e) {
          lastErr = e;
          throw e;
        }
      }
      const id = String(data?.captcha_id ?? data?.id ?? "");
      const image = String(data?.image ?? "").trim();
      if (!id || !image.startsWith("data:image/")) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error("empty captcha from server");
      }
      setCaptcha({ id, image });
      setCaptchaStatus("ready");
      // Local/dev API returns the answer — auto-fill so register isn't blocked.
      const answer = String(data?.dev_answer ?? "").trim();
      if (answer) setCaptchaCode(answer);
      setError(null);
    } catch (e: any) {
      setCaptcha(null);
      setCaptchaStatus("error");
      const msg =
        e?.name === "AbortError"
          ? "Captcha timed out — click image to retry"
          : `Captcha unavailable: ${e.message || "network error"} (click to retry)`;
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
      if (!isValidPhone(phone)) {
        setError("Phone must be exactly 11 digits");
        return;
      }
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
      const early = validateLoginCredentials({
        phone,
        password,
        username,
        requireUsername: mode === "register",
      });
      if (early) {
        setError(early);
        return;
      }
      if (mode === "register" && !inviteCode.trim()) {
        setError("Company invite code is required");
        return;
      }
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
        payload.username = username.trim();
        payload.invite_code = inviteCode.trim().toUpperCase();
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
      {showDownload && (
        <Link href="/download" className="auth-download-link" aria-label={t("download.nav")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 3a1 1 0 0 1 1 1v9.6l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0L6.8 12.2a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z" />
          </svg>
          {t("download.nav")}
        </Link>
      )}
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-logo">Q</div>
        <div className="auth-title">
          {mode === "login" ? "Sign in to Qchat" : "Create your account"}
        </div>
        <div className="auth-sub">
          {mode === "login"
            ? "Secure enterprise messaging"
            : "Join your company with an invite code. SMS verification required."}
        </div>

        <div className="field">
          <label>Phone (11 digits)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="13800000002"
            inputMode="numeric"
            autoComplete="tel"
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

        {mode === "register" && (
          <div className="field">
            <label>Company invite code</label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="ACME2026"
              autoComplete="off"
              required
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              From your organization admin. You can still switch companies later from chat.
            </div>
          </div>
        )}
        <div className="field">
          <label>Password</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 8 letters/digits"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
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
              title="Click to refresh captcha"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (captchaStatus !== "loading") void loadCaptcha();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (captchaStatus !== "loading") void loadCaptcha();
                }
              }}
            >
              {captchaStatus === "loading" && <span className="captcha-image-fallback">…</span>}
              {captchaStatus === "error" && (
                <span className="captcha-image-fallback">Unavailable — click</span>
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
              setSmsCode(mode === "login" ? "12345" : "");
              setSmsChallengeId("");
              setSmsHint(mode === "login" ? "Test SMS code: 12345" : null);
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
