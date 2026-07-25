"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@qchat/i18n";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import PageHeader from "@/components/PageHeader";
import { api, clearToken, apiBaseUrl } from "@/lib/api";
import { AVATAR_MAX_BYTES, isAvatarFile } from "@/lib/mediaLimits";
import {
  loadLocalNotifyProps,
  saveLocalNotifyProps,
  type NotifyProps,
} from "@/lib/notifyProps";
import {
  listPushDevices,
  removePushDevice,
  unregisterWebPush,
  type PushDevice,
} from "@/lib/webPush";
import { useLocale } from "@/lib/locale";
import { useTheme, type ThemeMode } from "@/lib/theme";
import type { LocaleMode } from "@qchat/i18n";

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

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function formatSessionActive(iso: string | undefined, t: Translate): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return t("time.justNow");
  if (sec < 3600) return t("time.minutesAgo", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("time.hoursAgo", { n: Math.floor(sec / 3600) });
  if (sec < 86400 * 7) return t("time.daysAgo", { n: Math.floor(sec / 86400) });
  return d.toLocaleString();
}

function deviceTypeLabel(deviceType: string, t: Translate): string {
  if (deviceType === "phone") return t("settings.deviceMobile");
  if (deviceType === "desktop") return t("settings.deviceDesktop");
  return t("settings.deviceWeb");
}

export default function ProfilePage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t, labelLocale, labelTheme } = useLocale();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [notify, setNotify] = useState({
    desktop: "all" as "all" | "mention" | "none",
    sound: true,
    mentions_only: false,
  });
  const [notifySaved, setNotifySaved] = useState(false);
  const [pushDevices, setPushDevices] = useState<PushDevice[]>([]);
  const [pushDevicesBusy, setPushDevicesBusy] = useState(false);
  const [pushDeviceError, setPushDeviceError] = useState<string | null>(null);
  const [loginSessions, setLoginSessions] = useState<
    {
      id: string;
      device_type: string;
      device_name: string;
      device_id: string;
      platform: string;
      ip: string;
      ip_region: string;
      location: string;
      current?: boolean;
      created_at: string;
      expires_at: string;
      last_active_at: string;
    }[]
  >([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);

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

  async function loadPushDevices() {
    try {
      setPushDevices(await listPushDevices());
      setPushDeviceError(null);
    } catch (e: any) {
      setPushDeviceError(e.message || t("settings.loadPushDevicesError"));
    }
  }

  async function loadLoginSessions() {
    try {
      const rows = await api<any>("/v1/me/sessions");
      const list = Array.isArray(rows) ? rows : [];
      setLoginSessions(
        list.map((s: any) => ({
          id: String(s?.id ?? ""),
          device_type: String(s?.device_type ?? ""),
          device_name: String(s?.device_name ?? ""),
          device_id: String(s?.device_id ?? ""),
          platform: String(s?.platform ?? s?.device_name ?? ""),
          ip: String(s?.ip ?? ""),
          ip_region: String(s?.ip_region ?? ""),
          location: String(s?.location ?? s?.ip_region ?? s?.ip ?? ""),
          current: Boolean(s?.current),
          created_at: String(s?.created_at ?? ""),
          expires_at: String(s?.expires_at ?? ""),
          last_active_at: String(s?.last_active_at ?? s?.created_at ?? ""),
        }))
      );
    } catch {
      setLoginSessions([]);
    }
  }

  async function revokeLoginSession(id: string, isCurrent: boolean) {
    setSessionsBusy(true);
    setError(null);
    try {
      await api(`/v1/me/sessions/${id}`, { method: "DELETE" });
      if (isCurrent) {
        clearToken();
        router.replace("/login");
        return;
      }
      await loadLoginSessions();
    } catch (e: any) {
      setError(e.message || t("settings.revokeSessionError"));
    } finally {
      setSessionsBusy(false);
    }
  }

  async function deletePushDevice(device: PushDevice) {
    setPushDevicesBusy(true);
    setPushDeviceError(null);
    try {
      await removePushDevice(device);
      setPushDevices((prev) => prev.filter((item) => item.id !== device.id));
    } catch (e: any) {
      setPushDeviceError(e.message || t("settings.removePushDeviceError"));
    } finally {
      setPushDevicesBusy(false);
    }
  }

  useEffect(() => {
    load();
    loadPushDevices();
    loadLoginSessions();
    const local = loadLocalNotifyProps();
    setNotify(local);
    api<any>("/v1/me/notify_props")
      .then((p) => {
        const next: NotifyProps = {
          desktop: p?.desktop === "mention" || p?.desktop === "none" ? p.desktop : "all",
          sound: p?.sound !== false,
          mentions_only: Boolean(p?.mentions_only),
        };
        setNotify(next);
        saveLocalNotifyProps(next);
      })
      .catch(() => {});
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
        <PageHeader title={t("menu.settings")} />

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
            <h2 style={{ margin: 0, fontSize: 16 }}>{t("appearance.title")}</h2>
            <div className="muted" style={{ fontSize: 12 }}>
              {t("appearance.hint")}
            </div>
            <label className="field">
              <span>{t("appearance.theme")}</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemeMode)}
              >
                {(["dark", "light", "system"] as ThemeMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {labelTheme(mode)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("appearance.language")}</span>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as LocaleMode)}
              >
                {(["en", "zh", "system"] as LocaleMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {labelLocale(mode)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{t("settings.notifications")}</h2>
            <div className="muted" style={{ fontSize: 12 }}>
              {t("settings.notificationsHint")}
            </div>
            <label className="field">
              <span>{t("settings.desktopNotifications")}</span>
              <select
                value={notify.desktop}
                onChange={(e) =>
                  setNotify({
                    ...notify,
                    desktop: e.target.value as NotifyProps["desktop"],
                  })
                }
              >
                <option value="all">{t("settings.notifyAll")}</option>
                <option value="mention">{t("settings.notifyMention")}</option>
                <option value="none">{t("settings.notifyNone")}</option>
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.sound}
                onChange={(e) => setNotify({ ...notify, sound: e.target.checked })}
              />
              {t("settings.playSound")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.mentions_only}
                onChange={(e) => setNotify({ ...notify, mentions_only: e.target.checked })}
              />
              {t("settings.mentionsOnlyHint")}
            </label>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setNotifySaved(false);
                  try {
                    await api("/v1/me/notify_props", {
                      method: "PUT",
                      body: JSON.stringify(notify),
                    });
                    saveLocalNotifyProps(notify);
                    setNotifySaved(true);
                  } catch (err: any) {
                    setError(err.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t("settings.saveNotifications")}
              </button>
              {notifySaved && <span className="muted">{t("common.saved")}</span>}
            </div>
          </div>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>{t("settings.sessions")}</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {t("settings.sessionsHint")}
              </div>
            </div>
            {loginSessions.length === 0 && (
              <div className="muted">{t("settings.noSessions")}</div>
            )}
            {loginSessions.map((s) => {
              const typeHint = deviceTypeLabel(s.device_type, t);
              const title =
                s.platform &&
                !["web", "desktop", "phone", "mobile", "browser"].includes(
                  s.platform.trim().toLowerCase()
                )
                  ? s.platform
                  : s.device_name && s.device_name.toLowerCase() !== "web"
                    ? s.device_name
                    : typeHint;
              return (
              <div className="list-row" key={s.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {title}
                    {s.current && (
                      <span className="tag-chip" style={{ marginLeft: 8 }}>
                        {t("settings.thisDevice")}
                      </span>
                    )}
                  </div>
                  {title !== typeHint && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {t("settings.sessionType", { type: typeHint })}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {s.location || t("settings.unknownLocation")}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {t("settings.lastActiveAt", {
                      time: formatSessionActive(s.last_active_at || s.created_at, t),
                    })}
                    {" · "}
                    {t("settings.signedIn", {
                      time: s.created_at ? new Date(s.created_at).toLocaleString() : "—",
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={sessionsBusy}
                  onClick={() => revokeLoginSession(s.id, Boolean(s.current))}
                >
                  {s.current ? t("nav.signOut") : t("settings.revoke")}
                </button>
              </div>
              );
            })}
          </div>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>{t("settings.pushDevices")}</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {t("settings.pushDevicesHint")}
              </div>
            </div>
            {pushDeviceError && <div className="error-text">{pushDeviceError}</div>}
            {pushDevices.length === 0 && (
              <div className="muted">{t("settings.noPushDevices")}</div>
            )}
            {pushDevices.map((device) => {
              const isCurrentOrigin =
                typeof window !== "undefined" && device.origin === window.location.origin;
              return (
                <div className="list-row" key={device.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {device.device_name || t("settings.webBrowser")}
                      {isCurrentOrigin && (
                        <span className="tag-chip" style={{ marginLeft: 8 }}>
                          {t("settings.thisOrigin")}
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                      {device.origin || t("settings.originUnavailable")}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {t("settings.lastRegistered", {
                        time: new Date(device.last_seen_at).toLocaleString(),
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pushDevicesBusy}
                    onClick={() => deletePushDevice(device)}
                  >
                    {t("common.remove")}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn-ghost"
              disabled={pushDevicesBusy}
              onClick={() => loadPushDevices()}
            >
              {t("settings.refreshDevices")}
            </button>
          </div>
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

        <div className="card">
          <div className="list-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t("settings.apiServer")}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {apiBaseUrl()}
              </div>
            </div>
          </div>
          <div className="list-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t("nav.logOut")}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t("settings.logoutHint")}
              </div>
            </div>
            <button
              className="btn"
              style={{ background: "var(--danger)" }}
              onClick={async () => {
                await unregisterWebPush().catch(() => false);
                await api("/v1/auth/logout", { method: "POST" }).catch(() => {});
                clearToken();
                router.replace("/login");
              }}
            >
              {t("nav.logOut")}
            </button>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
