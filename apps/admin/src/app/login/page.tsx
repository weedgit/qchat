"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

interface CaptchaState {
  id: string;
  challenge: string;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("13800000001");
  const [password, setPassword] = useState("admin12345");
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
      const data = await api<any>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          phone,
          password,
          captcha_id: captcha?.id ?? "",
          captcha: captchaCode,
          device_type: "web",
          device_name: "admin-web",
          platform: "Admin · Web",
          remember_me: remember,
        }),
      });
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("No access_token in response");
      setToken(String(token), remember);
      router.replace("/");
    } catch (e: any) {
      setError(e.message);
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
        <div className="auth-title">Qchat Admin Console</div>
        <div className="auth-sub">Enterprise / platform administration</div>

        <div className="field">
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="field">
          <label>Captcha</label>
          <div className="captcha-row">
            <input
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              required
              placeholder="Enter captcha"
            />
            <button type="button" className="btn-ghost" onClick={loadCaptcha}>
              {captcha?.challenge || "Refresh"}
            </button>
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
