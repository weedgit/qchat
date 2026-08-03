"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatApiError } from "@qchat/i18n";
import LoadingSplash from "@/components/LoadingSplash";
import { PasswordInput } from "@/components/PasswordInput";
import { api, getToken, restoreDesktopSession, setTokens } from "@/lib/api";
import { validateLoginCredentials } from "@/lib/credentials";
import { getAuthDevice } from "@/lib/device";
import { isElectronShell } from "@/lib/downloads";
import { useLocale } from "@/lib/locale";
import type { MessageKey } from "@qchat/i18n";

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
            reason === "banned" ? t("login.errBanned") : t("login.errSignedOut")
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
  }, [router, t]);

  const loadCaptcha = useCallback(async () => {
    setCaptcha(null);
    setCaptchaStatus("loading");
    try {
      let data: any = null;
      let lastErr: unknown = null;

      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
        new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(Object.assign(new Error(label), { name: "AbortError" })),
            ms
          );
          p.then(
            (v) => {
              window.clearTimeout(timer);
              resolve(v);
            },
            (e) => {
              window.clearTimeout(timer);
              reject(e);
            }
          );
        });

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
      const answer = String(data?.dev_answer ?? "").trim();
      if (answer) setCaptchaCode(answer);
      // Do not clear auth/register errors here — reload runs after failed submit.
    } catch (e: any) {
      setCaptcha(null);
      setCaptchaStatus("error");
      const msg =
        e?.name === "AbortError"
          ? t("login.captchaTimeout")
          : t("login.captchaError", {
              detail: formatApiError(e, t, "api.err.network"),
            });
      setError(msg);
    }
  }, [t]);

  useEffect(() => {
    if (checkingSession) return;
    loadCaptcha();
  }, [loadCaptcha, checkingSession]);

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
        setError(t(early as MessageKey));
        return;
      }
      if (mode === "register" && !inviteCode.trim()) {
        setError(t("login.inviteRequired"));
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
      } else {
        payload.remember_me = remember;
      }
      const data = await api<any>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error(t("login.errNoToken"));
      setTokens(String(token), String(data?.refresh_token ?? ""), mode === "register" ? true : remember);
      setEnteringApp(true);
      router.replace("/");
    } catch (e: unknown) {
      setError(formatApiError(e, t, mode === "register" ? "login.errGeneric" : "login.requestFailed"));
      setCaptchaCode("");
      void loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession || enteringApp) {
    return (
      <LoadingSplash
        label={enteringApp ? t("login.openingChat") : t("login.starting")}
      />
    );
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
        <div className="auth-logo">R</div>
        <div className="auth-title">
          {mode === "login" ? t("login.signInToApp") : t("login.createAccount")}
        </div>
        <div className="auth-sub">
          {mode === "login" ? t("login.subtitleLogin") : t("login.subtitleRegister")}
        </div>

        <div className="field">
          <label>{t("login.phoneDigits")}</label>
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
            <label>{t("login.username")}</label>
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
            <label>{t("login.inviteCode")}</label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="ACME2026"
              autoComplete="off"
              required
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {t("login.inviteLaterHint")}
            </div>
          </div>
        )}
        <div className="field">
          <label>{t("login.password")}</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("login.passwordPlaceholder")}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </div>

        <div className="field">
          <label>{t("login.captcha")}</label>
          <div className="captcha-row">
            <input
              className="captcha-input"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
              placeholder={t("login.captchaPlaceholder")}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            <div
              className={`captcha-image-wrap ${captchaStatus === "error" ? "error" : ""}`}
              aria-label={t("login.captcha")}
              title={t("login.captchaRefresh")}
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
                <span className="captcha-image-fallback">{t("login.captchaUnavailable")}</span>
              )}
              {captchaStatus === "ready" && captcha?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="captcha-image" src={captcha.image} alt={t("login.captcha")} draggable={false} />
              ) : null}
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
              {t("login.rememberDays")}
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
            {mode === "login" ? t("login.needAccount") : t("login.haveAccount")}
          </button>
        </div>

        {error && (
          <div className="error-text auth-error" role="alert">
            {error}
          </div>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy
            ? t("login.pleaseWait")
            : mode === "login"
              ? t("login.submitLogin")
              : t("login.register")}
        </button>
      </form>
    </div>
  );
}
