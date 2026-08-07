"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/PasswordInput";
import { ApiError, api, setToken } from "@/lib/api";
import { validateLoginCredentials } from "@/lib/credentials";
import { formatAdminError } from "@/lib/errors";
import LanguageSelect from "@/components/LanguageSelect";
import { useLocale } from "@/lib/locale";
import { useToast } from "@/components/Toast";

interface CaptchaState {
  id: string;
  image: string;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadCaptcha = useCallback(async () => {
    setCaptcha(null);
    try {
      const data = await api<any>("/v1/auth/captcha");
      const id = String(data?.captcha_id ?? data?.id ?? "");
      const image = String(data?.image ?? "").trim();
      if (!id || !image.startsWith("data:image/")) {
        throw new Error("empty captcha image");
      }
      setCaptcha({ id, image });
    } catch (e) {
      toast.error(formatAdminError(e, t, "admin.err.captchaUnavailable"));
    }
  }, [t, toast]);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const early = validateLoginCredentials({ phone, password });
      if (early) {
        toast.error(t(early));
        return;
      }
      const payload: Record<string, unknown> = {
        phone,
        password,
        captcha_id: captcha?.id ?? "",
        captcha: captchaCode,
        device_type: "web",
        device_name: "admin-web",
        platform: "Admin · Web",
        remember_me: remember,
      };
      if (mfaRequired || mfaCode.trim()) {
        payload.mfa_code = mfaCode.trim();
      }
      const data = await api<any>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("no access_token");
      setToken(String(token), remember);
      router.replace("/");
    } catch (e) {
      const code = e instanceof ApiError ? String((e.body as { code?: string })?.code ?? "") : "";
      if (code === "mfa_required") {
        setMfaRequired(true);
        toast.warn(t("admin.err.mfaRequired"));
      } else if (code === "mfa_invalid") {
        setMfaRequired(true);
        toast.error(t("admin.err.mfaInvalid"));
      } else if (code === "ip_not_allowed") {
        toast.error(t("admin.err.ipNotAllowed"));
      } else {
        toast.error(formatAdminError(e, t, "admin.err.generic"));
      }
      setCaptchaCode("");
      setMfaCode("");
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-logo">R</div>
        <div className="auth-title">{t("admin.login.title")}</div>
        <div className="auth-sub">{t("admin.login.subtitle")}</div>

        <div className="field" style={{ marginBottom: 12 }}>
          <LanguageSelect id="login-lang" />
        </div>

        <div className="field">
          <label>{t("admin.login.phone")}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            inputMode="numeric"
            autoComplete="tel"
            required
          />
        </div>
        <div className="field">
          <label>{t("admin.login.password")}</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {mfaRequired ? (
          <div className="field">
            <label>{t("admin.login.mfa")}</label>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.toUpperCase().slice(0, 16))}
              required
              autoComplete="one-time-code"
              placeholder={t("admin.login.mfaPlaceholder")}
              autoFocus
            />
          </div>
        ) : null}
        <div className="field">
          <label>{t("admin.login.captcha")}</label>
          <div className="captcha-row">
            <input
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
              required
              placeholder={t("admin.login.captchaPlaceholder")}
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <div className="captcha-image-wrap" aria-label="Captcha image">
              {captcha?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="captcha-image" src={captcha.image} alt="Captcha" draggable={false} />
              ) : (
                <span>…</span>
              )}
            </div>
          </div>
        </div>
        <label className="remember-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t("admin.login.remember")}
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t("admin.login.submitting") : t("admin.login.submit")}
        </button>
      </form>
    </div>
  );
}
