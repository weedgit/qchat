"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@qchat/i18n";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { api, clearToken, apiBaseUrl } from "@/lib/api";
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

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t, labelLocale, labelTheme } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
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
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        await api("/v1/me");
        if (cancelled) return;
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
      if (cancelled) return;
      loadPushDevices();
      loadLoginSessions();
      const local = loadLocalNotifyProps();
      setNotify(local);
      api<any>("/v1/me/notify_props")
        .then((p) => {
          if (cancelled) return;
          const next: NotifyProps = {
            desktop: p?.desktop === "mention" || p?.desktop === "none" ? p.desktop : "all",
            sound: p?.sound !== false,
            mentions_only: Boolean(p?.mentions_only),
          };
          setNotify(next);
          saveLocalNotifyProps(next);
        })
        .catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  return (
    <AppShell rail={false}>
      <main className="page-pane">
        <PageHeader title={t("menu.settings")} />

        {error && (
          <div className="card">
            <div className="error-text">{error}</div>
          </div>
        )}

        {ready && (
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

        {ready && (
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

        {ready && (
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

        {ready && (
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
