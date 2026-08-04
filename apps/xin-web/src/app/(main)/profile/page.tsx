"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatApiError } from "@qchat/i18n";
import Avatar from "@/components/Avatar";
import MenuModal from "@/components/MenuModal";
import { PasswordInput } from "@/components/PasswordInput";
import { api } from "@/lib/api";
import { useMe } from "@/lib/MeContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import { displayNameError, isValidDisplayName, isValidUsername } from "@/lib/credentials";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, isAvatarFile } from "@/lib/mediaLimits";
import { useLocale } from "@/lib/locale";

function RowIcon({ d }: { d: string }) {
  return (
    <svg
      className="menu-modal-row-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

function CopyHintIcon({ copied }: { copied: boolean }) {
  return (
    <svg
      className={`menu-modal-copy-hint${copied ? " is-copied" : ""}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {copied ? (
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 12l2.5 2.5 4.5-4.5" />
      ) : (
        <path d="M9 9h10v12H9z M5 15V3h10" />
      )}
    </svg>
  );
}

const ROW_ICONS = {
  name: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  realName:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5.5 16.5c.6-1.6 1.9-2.5 3.5-2.5s2.9.9 3.5 2.5 M15 10h4 M15 14h3",
  age: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 7v5l3 2",
  region:
    "M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  signature: "M3 17c3-1 4-9 7-9s3 6 5 6 3-2 6-2 M3 20h18",
  phone:
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  username:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M16 8v5a3 3 0 0 0 6 0v-1 M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z",
  changePhone:
    "M15.05 5A5 5 0 0 1 19 8.95 M15.05 1A9 9 0 0 1 23 8.94 M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
} as const;

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
  enterprise_id: string;
  enterprise_name: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useLocale();
  const { patchMe, refreshMe } = useMe();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedField, setCopiedField] = useState<"phone" | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const initialDisplayNameRef = useRef("");
  const initialUsernameRef = useRef("");
  const [displayNameTaken, setDisplayNameTaken] = useState(false);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);

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
      patchMe({ avatarUrl: url });
      void refreshMe();
    } catch (err: unknown) {
      setError(formatApiError(err, t));
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
        enterprise_id: String(u?.enterprise_id ?? "").trim(),
        enterprise_name: String(u?.enterprise_name ?? "").trim(),
      });
      initialDisplayNameRef.current = String(u?.display_name ?? u?.username ?? "").trim();
      initialUsernameRef.current = String(u?.username ?? "").trim();
      setDisplayNameTaken(false);
      setUsernameTaken(false);
    } catch (e: unknown) {
      setError(formatApiError(e, t, "api.err.loadFailed"));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  useEffect(() => {
    if (!me) return;
    const name = me.display_name.trim();
    if (
      !name ||
      !isValidDisplayName(name) ||
      name.toLocaleLowerCase() === initialDisplayNameRef.current.toLocaleLowerCase()
    ) {
      setDisplayNameTaken(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<{ available?: boolean }>(
        `/v1/display-names/available?display_name=${encodeURIComponent(name)}`
      )
        .then((res) => {
          if (!cancelled) setDisplayNameTaken(res?.available === false);
        })
        .catch(() => {
          if (!cancelled) setDisplayNameTaken(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [me?.display_name]);

  useEffect(() => {
    if (!me) return;
    const username = me.username.trim();
    if (
      !username ||
      !isValidUsername(username) ||
      username.toLocaleLowerCase() === initialUsernameRef.current.toLocaleLowerCase()
    ) {
      setUsernameTaken(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<{ available?: boolean }>(
        `/v1/usernames/available?username=${encodeURIComponent(username)}`
      )
        .then((res) => {
          if (!cancelled) setUsernameTaken(res?.available === false);
        })
        .catch(() => {
          if (!cancelled) setUsernameTaken(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [me?.username]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    const dnErr = displayNameError(me.display_name);
    if (dnErr) {
      setError(dnErr);
      return;
    }
    if (displayNameTaken) {
      setError(t("me.displayNameTaken"));
      return;
    }
    const username = me.username.trim();
    if (!isValidUsername(username)) {
      setError(t("me.usernameInvalid"));
      return;
    }
    if (usernameTaken) {
      setError(t("me.usernameTaken"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api("/v1/me", {
        method: "PATCH",
        body: JSON.stringify({
          username,
          display_name: me.display_name.trim(),
          real_name: me.real_name,
          age: me.age,
          region: me.region,
          signature: me.signature,
          avatar_url: me.avatar_url,
          profile_visibility: me.profile_visibility,
          friend_privacy: me.friend_privacy,
        }),
      });
      patchMe({
        avatarUrl: me.avatar_url || undefined,
        nickname: me.display_name,
        username,
        phone: me.phone,
      });
      void refreshMe();
      router.push("/");
    } catch (err: unknown) {
      setError(formatApiError(err, t));
      setSaving(false);
    }
  }

  function copyField(field: "phone", value: string) {
    const text = value.trim();
    if (!text) return;
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopiedField(field);
      setTimeout(() => setCopiedField((cur) => (cur === field ? null : cur)), 1500);
    });
  }

  return (
    <MenuModal
      title={t("me.editProfile")}
      ariaLabel={t("nav.profile")}
      overlayClassName="edit-profile-modal"
      action={
        <button
          type="button"
          className="menu-modal-action"
          disabled={saving || !me || displayNameTaken || usernameTaken}
          onClick={() => {
            const form = document.getElementById(
              "profile-edit-form"
            ) as HTMLFormElement | null;
            form?.requestSubmit();
          }}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      }
    >
      {error && (
        <div className="menu-modal-error">{t("me.profileLoadError", { error })}</div>
      )}

      <div className="menu-modal-hero">
        <button
          type="button"
          className="avatar-edit menu-modal-avatar"
          title={t("me.changeAvatar")}
          disabled={saving || !me}
          onClick={() => avatarInputRef.current?.click()}
        >
          <Avatar
            name={me?.display_name ?? "?"}
            url={me?.avatar_url || undefined}
            size={112}
          />
          <span className="avatar-edit-overlay" aria-hidden>
            {"\u{1F4F7}"}
          </span>
        </button>
        {me ? (
          <div
            className={`menu-modal-hero-sub${me.enterprise_id ? " is-enterprise" : ""}`}
          >
            {me.enterprise_id
              ? me.enterprise_name
                ? `${t("account.enterprise")} · ${me.enterprise_name}`
                : t("account.enterprise")
              : t("account.enterprise")}
          </div>
        ) : null}
        <input
          ref={avatarInputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) uploadAvatar(file);
          }}
        />
      </div>

      {me && (
        <>
          <section className="menu-modal-section">
            <button
              type="button"
              className="menu-modal-row menu-modal-row-lead"
              title={t("me.copyPhone")}
              disabled={!me.phone}
              onClick={() => copyField("phone", me.phone)}
            >
              <RowIcon d={ROW_ICONS.phone} />
              <span className="menu-modal-row-main">
                <span className="menu-modal-value">{me.phone || "—"}</span>
              </span>
              <CopyHintIcon copied={copiedField === "phone"} />
            </button>
          </section>

          <form
            id="profile-edit-form"
            className="menu-modal-section"
            onSubmit={onSave}
          >
            <label className="menu-modal-field menu-modal-field-lead">
              <RowIcon d={ROW_ICONS.name} />
              <div className="menu-modal-field-body">
                <span>{t("me.displayName")}</span>
                <input
                  value={me.display_name}
                  onChange={(e) => setMe({ ...me, display_name: e.target.value })}
                  aria-invalid={displayNameTaken}
                />
                {displayNameTaken ? (
                  <span className="menu-modal-field-error">{t("me.displayNameTaken")}</span>
                ) : null}
              </div>
            </label>
            <label className="menu-modal-field menu-modal-field-lead">
              <RowIcon d={ROW_ICONS.username} />
              <div className="menu-modal-field-body">
                <span>{t("me.username")}</span>
                <input
                  value={me.username}
                  onChange={(e) => setMe({ ...me, username: e.target.value })}
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={32}
                  aria-invalid={usernameTaken}
                />
                {usernameTaken ? (
                  <span className="menu-modal-field-error">{t("me.usernameTaken")}</span>
                ) : null}
              </div>
            </label>
            <label className="menu-modal-field menu-modal-field-lead">
              <RowIcon d={ROW_ICONS.realName} />
              <div className="menu-modal-field-body">
                <span>{t("me.realName")}</span>
                <input
                  value={me.real_name}
                  onChange={(e) => setMe({ ...me, real_name: e.target.value })}
                />
              </div>
            </label>
            <label className="menu-modal-field menu-modal-field-lead">
              <RowIcon d={ROW_ICONS.age} />
              <div className="menu-modal-field-body">
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
              </div>
            </label>
            <label className="menu-modal-field menu-modal-field-lead">
              <RowIcon d={ROW_ICONS.region} />
              <div className="menu-modal-field-body">
                <span>{t("me.region")}</span>
                <input
                  value={me.region}
                  onChange={(e) => setMe({ ...me, region: e.target.value })}
                />
              </div>
            </label>
            <label className="menu-modal-field menu-modal-field-lead">
              <RowIcon d={ROW_ICONS.signature} />
              <div className="menu-modal-field-body">
                <span>{t("me.signature")}</span>
                <input
                  value={me.signature}
                  onChange={(e) => setMe({ ...me, signature: e.target.value })}
                />
              </div>
            </label>
          </form>

          <section className="menu-modal-section">
            <div className="menu-modal-section-title">{t("me.privacyTitle")}</div>
            <label className="menu-modal-field">
              <span>{t("me.profileVisibility")}</span>
              <select
                value={me.profile_visibility}
                onChange={(e) => setMe({ ...me, profile_visibility: e.target.value })}
              >
                <option value="public">{t("me.visibilityPublic")}</option>
                <option value="friends">{t("me.visibilityFriends")}</option>
              </select>
            </label>
            <label className="menu-modal-field">
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
          </section>

          <section className="menu-modal-section">
            <button
              type="button"
              className="menu-modal-row menu-modal-row-lead"
              onClick={() => setPhoneOpen((v) => !v)}
            >
              <RowIcon d={ROW_ICONS.changePhone} />
              <span className="menu-modal-row-main">
                <span className="menu-modal-value">{t("settings.changePhone")}</span>
                <span className="menu-modal-label">{t("me.phoneHint")}</span>
              </span>
            </button>
            {phoneOpen && (
              <div className="menu-modal-panel">
                <input
                  placeholder={t("settings.newPhone")}
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  inputMode="numeric"
                />
                <PasswordInput
                  placeholder={t("settings.confirmPassword")}
                  value={phonePassword}
                  onChange={(e) => setPhonePassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  className="btn"
                  type="button"
                  disabled={saving || newPhone.length !== 11 || !phonePassword}
                  onClick={async () => {
                    setSaving(true);
                    setPhoneHint(null);
                    try {
                      const res = await api<any>("/v1/me/phone", {
                        method: "PUT",
                        body: JSON.stringify({
                          new_phone: newPhone,
                          password: phonePassword,
                        }),
                      });
                      setMe({ ...me, phone: String(res?.phone ?? newPhone) });
                      setPhonePassword("");
                      setNewPhone("");
                      setPhoneHint(t("settings.phoneUpdated"));
                      setPhoneOpen(false);
                    } catch (err: any) {
                      setPhoneHint(err.message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {t("settings.confirmPhone")}
                </button>
                {phoneHint && <div className="muted">{phoneHint}</div>}
              </div>
            )}
          </section>
        </>
      )}
    </MenuModal>
  );
}
