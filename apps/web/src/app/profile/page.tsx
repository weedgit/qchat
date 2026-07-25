"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { AVATAR_MAX_BYTES, isAvatarFile } from "@/lib/mediaLimits";
import { useLocale } from "@/lib/locale";

interface Profile {
  id: string;
  phone: string;
  username: string;
  display_name: string;
  real_name: string;
  age: number | null;
  region: string;
  signature: string;
  avatar_url: string;
  profile_visibility: string;
  friend_privacy: string;
}

export default function ProfilePage() {
  const { t } = useLocale();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [phoneHint, setPhoneHint] = useState<string | null>(null);

  async function uploadAvatar(file: File) {
    if (!me) return;
    if (!isAvatarFile(file)) {
      setError(t("media.avatarMustBeImage"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(t("media.avatarTooLarge"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "avatar");
      const up = await api<any>("/v1/media/upload", { method: "POST", body: fd });
      const url = String(up?.url ?? "");
      await api("/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ avatar_url: url }),
      });
      setMe({ ...me, avatar_url: url });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    setError(null);
    try {
      const u = await api<any>("/v1/me");
      setMe({
        id: String(u?.id ?? ""),
        phone: String(u?.phone ?? ""),
        username: String(u?.username ?? ""),
        display_name: String(u?.display_name ?? u?.username ?? t("me.title")),
        real_name: String(u?.real_name ?? ""),
        age: typeof u?.age === "number" ? u.age : null,
        region: String(u?.region ?? ""),
        signature: String(u?.signature ?? ""),
        avatar_url: String(u?.avatar_url ?? ""),
        profile_visibility: String(u?.profile_visibility ?? "friends"),
        friend_privacy: String(u?.friend_privacy ?? "approval"),
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api("/v1/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: me.display_name,
          real_name: me.real_name,
          age: me.age,
          region: me.region,
          signature: me.signature,
          avatar_url: me.avatar_url,
          profile_visibility: me.profile_visibility,
          friend_privacy: me.friend_privacy,
        }),
      });
      setSaved(true);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell rail={false}>
      <main className="page-pane">
        <PageHeader title={t("nav.profile")} />

        {error && (
          <div className="card">
            <div className="error-text">{t("me.profileLoadError", { error })}</div>
          </div>
        )}

        <div className="card" style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <button
            type="button"
            className="avatar-edit"
            title={t("me.changeAvatar")}
            disabled={saving || !me}
            onClick={() => avatarInputRef.current?.click()}
          >
            <Avatar name={me?.display_name ?? "?"} url={me?.avatar_url || undefined} size={72} />
            <span className="avatar-edit-overlay" aria-hidden>
              {"\u{1F4F7}"}
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadAvatar(file);
            }}
          />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {me?.display_name ?? t("common.loading")}
            </div>
            <div className="muted">@{me?.username || "—"} · {me?.phone || "—"}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              ID: {me?.id || "—"}
            </div>
          </div>
        </div>

        {me && (
          <form className="card" onSubmit={onSave} style={{ display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{t("me.editProfile")}</h2>

            <label className="field">
              <span>{t("me.username")}</span>
              <input value={me.username} disabled />
              <span className="muted" style={{ fontSize: 12 }}>
                {t("me.usernameHint")}
              </span>
            </label>

            <label className="field">
              <span>{t("me.phone")}</span>
              <input value={me.phone} disabled />
              <span className="muted" style={{ fontSize: 12 }}>
                {t("me.phoneHint")}
              </span>
            </label>

            <label className="field">
              <span>{t("me.displayName")}</span>
              <input
                value={me.display_name}
                onChange={(e) => setMe({ ...me, display_name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("me.realName")}</span>
              <input
                value={me.real_name}
                onChange={(e) => setMe({ ...me, real_name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("me.age")}</span>
              <input
                type="number"
                value={me.age ?? ""}
                onChange={(e) =>
                  setMe({
                    ...me,
                    age: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              <span>{t("me.region")}</span>
              <input
                value={me.region}
                onChange={(e) => setMe({ ...me, region: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("me.signature")}</span>
              <input
                value={me.signature}
                onChange={(e) => setMe({ ...me, signature: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("me.profileVisibility")}</span>
              <select
                value={me.profile_visibility}
                onChange={(e) => setMe({ ...me, profile_visibility: e.target.value })}
              >
                <option value="public">{t("me.visibilityPublic")}</option>
                <option value="friends">{t("me.visibilityFriends")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("me.friendRequests")}</span>
              <select
                value={me.friend_privacy}
                onChange={(e) => setMe({ ...me, friend_privacy: e.target.value })}
              >
                <option value="open">{t("me.friendOpen")}</option>
                <option value="approval">{t("me.friendApproval")}</option>
                <option value="closed">{t("me.friendClosed")}</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? t("common.saving") : t("common.saveChanges")}
              </button>
              {saved && <span className="muted">{t("common.saved")}</span>}
            </div>
          </form>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{t("settings.changePhone")}</h2>
            <input
              placeholder={t("settings.newPhone")}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            {!challengeId ? (
              <button
                className="btn"
                type="button"
                disabled={saving || newPhone.length !== 11}
                onClick={async () => {
                  setSaving(true);
                  setPhoneHint(null);
                  try {
                    const res = await api<any>("/v1/me/phone/request", {
                      method: "POST",
                      body: JSON.stringify({ new_phone: newPhone }),
                    });
                    setChallengeId(String(res?.challenge_id ?? ""));
                    setPhoneHint(
                      res?.dev_code
                        ? t("settings.smsSentDev", { code: String(res.dev_code) })
                        : t("settings.smsSent")
                    );
                  } catch (err: any) {
                    setPhoneHint(err.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t("settings.sendSms")}
              </button>
            ) : (
              <>
                <input
                  placeholder={t("settings.verifyCode")}
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                />
                <button
                  className="btn"
                  type="button"
                  disabled={saving || !phoneCode}
                  onClick={async () => {
                    setSaving(true);
                    setPhoneHint(null);
                    try {
                      const res = await api<any>("/v1/me/phone/confirm", {
                        method: "POST",
                        body: JSON.stringify({ challenge_id: challengeId, code: phoneCode }),
                      });
                      setMe({ ...me, phone: String(res?.phone ?? newPhone) });
                      setChallengeId("");
                      setPhoneCode("");
                      setNewPhone("");
                      setPhoneHint(t("settings.phoneUpdated"));
                    } catch (err: any) {
                      setPhoneHint(err.message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {t("settings.confirmPhone")}
                </button>
              </>
            )}
            {phoneHint && <div className="muted">{phoneHint}</div>}
          </div>
        )}
      </main>
    </AppShell>
  );
}
