"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/PasswordInput";
import { ApiError, api, setToken } from "@/lib/api";
import { validateLoginCredentials } from "@/lib/credentials";

interface CaptchaState {
  id: string;
  image: string;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const early = validateLoginCredentials({ phone, password });
      if (early) {
        setError(early);
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
      if (!token) throw new Error("No access_token in response");
      setToken(String(token), remember);
      router.replace("/");
    } catch (e: any) {
      const code =
        e instanceof ApiError ? String((e.body as any)?.code ?? "") : "";
      if (code === "mfa_required") {
        setMfaRequired(true);
        setError("Enter an authenticator code or a one-time recovery code.");
      } else if (code === "mfa_invalid") {
        setMfaRequired(true);
        setError("Invalid MFA or recovery code. Try again.");
      } else if (code === "ip_not_allowed") {
        setError("Sign-in is not allowed from this IP address.");
      } else {
        setError(e.message);
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
        <div className="auth-logo">Q</div>
        <div className="auth-title">Qchat Admin Console</div>
        <div className="auth-sub">Enterprise / platform administration</div>

        <div className="field">
          <label>Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            inputMode="numeric"
            autoComplete="tel"
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {mfaRequired ? (
          <div className="field">
            <label>Authenticator or recovery code</label>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.toUpperCase().slice(0, 16))}
              required
              autoComplete="one-time-code"
              placeholder="6-digit or XXXX-XXXX"
              autoFocus
            />
          </div>
        ) : null}
        <div className="field">
          <label>Captcha</label>
          <div className="captcha-row">
            <input
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              required
              placeholder="Enter captcha"
              autoComplete="off"
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
          Remember me
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
