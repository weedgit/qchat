"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LocaleMode, MessageKey, ResolvedLocale } from "@qchat/i18n";
import { formatApiError, intlLocale } from "@qchat/i18n";
import MenuModal from "@/components/MenuModal";
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

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function formatSessionActive(
  iso: string | undefined,
  t: Translate,
  locale: ResolvedLocale
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return t("time.justNow");
  if (sec < 3600) return t("time.minutesAgo", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("time.hoursAgo", { n: Math.floor(sec / 3600) });
  if (sec < 86400 * 7) return t("time.daysAgo", { n: Math.floor(sec / 86400) });
  return d.toLocaleString(intlLocale(locale));
}

function deviceTypeLabel(deviceType: string, t: Translate): string {
  if (deviceType === "phone") return t("settings.deviceMobile");
  if (deviceType === "desktop") return t("settings.deviceDesktop");
  return t("settings.deviceWeb");
}

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t, labelLocale, labelTheme, resolved } = useLocale();
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
    } catch (e: unknown) {
      setPushDeviceError(formatApiError(e, t, "settings.loadPushDevicesError"));
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
    } catch (e: unknown) {
      setError(formatApiError(e, t, "settings.revokeSessionError"));
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
    } catch (e: unknown) {
      setPushDeviceError(formatApiError(e, t, "settings.removePushDeviceError"));
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
      } catch (e: unknown) {
        if (!cancelled) setError(formatApiError(e, t, "api.err.loadFailed"));
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
            desktop:
              p?.desktop === "mention" || p?.desktop === "none" ? p.desktop : "all",
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
    <MenuModal title={t("menu.settings")} ariaLabel={t("menu.settings")}>
      {error && <div className="menu-modal-error">{error}</div>}

      {ready && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("appearance.title")}</div>
          <div className="menu-modal-hint">{t("appearance.hint")}</div>
          <label className="menu-modal-field">
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
          <label className="menu-modal-field">
            <span>{t("appearance.language")}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleMode)}
            >
              {(["en", "zh"] as LocaleMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {labelLocale(mode)}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {ready && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("settings.notifications")}</div>
          <div className="menu-modal-hint">{t("settings.notificationsHint")}</div>
          <label className="menu-modal-field">
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
          <label className="menu-modal-check">
            <input
              type="checkbox"
              checked={notify.sound}
              onChange={(e) => setNotify({ ...notify, sound: e.target.checked })}
            />
            <span>{t("settings.playSound")}</span>
          </label>
          <label className="menu-modal-check">
            <input
              type="checkbox"
              checked={notify.mentions_only}
              onChange={(e) =>
                setNotify({ ...notify, mentions_only: e.target.checked })
              }
            />
            <span>{t("settings.mentionsOnlyHint")}</span>
          </label>
          <div className="menu-modal-panel">
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
                } catch (err: unknown) {
                  setError(formatApiError(err, t));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? t("common.saving")
                : notifySaved
                  ? t("common.saved")
                  : t("settings.saveNotifications")}
            </button>
          </div>
        </section>
      )}

      {ready && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("settings.sessions")}</div>
          <div className="menu-modal-hint">{t("settings.sessionsHint")}</div>
          {loginSessions.length === 0 && (
            <div className="menu-modal-empty">{t("settings.noSessions")}</div>
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
              <div className="menu-modal-list-row" key={s.id}>
                <div className="menu-modal-list-main">
                  <div className="menu-modal-list-title">
                    {title}
                    {s.current ? ` · ${t("settings.thisDevice")}` : ""}
                  </div>
                  {title !== typeHint && (
                    <div className="menu-modal-list-sub">
                      {t("settings.sessionType", { type: typeHint })}
                    </div>
                  )}
                  <div className="menu-modal-list-sub">
                    {s.location || t("settings.unknownLocation")}
                  </div>
                  <div className="menu-modal-list-sub">
                    {t("settings.lastActiveAt", {
                      time: formatSessionActive(s.last_active_at || s.created_at, t, resolved),
                    })}
                    {" · "}
                    {t("settings.signedIn", {
                      time: s.created_at
                        ? new Date(s.created_at).toLocaleString(intlLocale(resolved))
                        : "—",
                    })}
                  </div>
                </div>
                <div className="menu-modal-list-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={sessionsBusy}
                    onClick={() => revokeLoginSession(s.id, Boolean(s.current))}
                  >
                    {s.current ? t("nav.signOut") : t("settings.revoke")}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {ready && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("settings.installApp")}</div>
          <div className="menu-modal-hint">{t("settings.installAppHint")}</div>
          <div className="menu-modal-hint">{t("settings.installAppIos")}</div>
          <div className="menu-modal-panel">
            <button
              type="button"
              className="btn"
              onClick={() => {
                try {
                  localStorage.removeItem("qchat.pwaInstallDismissed");
                } catch {
                  /* ignore */
                }
                window.dispatchEvent(new Event("qchat:pwa-install-reshow"));
              }}
            >
              {t("settings.installAppAction")}
            </button>
          </div>
        </section>
      )}

      {ready && (
        <section className="menu-modal-section">
          <div className="menu-modal-section-title">{t("settings.pushDevices")}</div>
          <div className="menu-modal-hint">{t("settings.pushDevicesHint")}</div>
          {pushDeviceError && (
            <div className="menu-modal-error">{pushDeviceError}</div>
          )}
          {pushDevices.length === 0 && (
            <div className="menu-modal-empty">{t("settings.noPushDevices")}</div>
          )}
          {pushDevices.map((device) => {
            const isCurrentOrigin =
              typeof window !== "undefined" &&
              device.origin === window.location.origin;
            return (
              <div className="menu-modal-list-row" key={device.id}>
                <div className="menu-modal-list-main">
                  <div className="menu-modal-list-title">
                    {device.device_name || t("settings.webBrowser")}
                    {isCurrentOrigin ? ` · ${t("settings.thisOrigin")}` : ""}
                  </div>
                  <div className="menu-modal-list-sub">
                    {device.origin || t("settings.originUnavailable")}
                  </div>
                  <div className="menu-modal-list-sub">
                    {t("settings.lastRegistered", {
                      time: new Date(device.last_seen_at).toLocaleString(intlLocale(resolved)),
                    })}
                  </div>
                </div>
                <div className="menu-modal-list-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pushDevicesBusy}
                    onClick={() => deletePushDevice(device)}
                  >
                    {t("common.remove")}
                  </button>
                </div>
              </div>
            );
          })}
          <div className="menu-modal-panel">
            <button
              type="button"
              className="btn-ghost"
              disabled={pushDevicesBusy}
              onClick={() => loadPushDevices()}
            >
              {t("settings.refreshDevices")}
            </button>
          </div>
        </section>
      )}

      <section className="menu-modal-section">
        <div className="menu-modal-section-title">{t("settings.apiServer")}</div>
        <div className="menu-modal-row menu-modal-row-lead is-static">
          <span className="menu-modal-row-main">
            <span className="menu-modal-value" style={{ color: "var(--text)" }}>
              {apiBaseUrl()}
            </span>
            <span className="menu-modal-label">{t("settings.apiServer")}</span>
          </span>
        </div>
        <div className="menu-modal-list-row">
          <div className="menu-modal-list-main">
            <div className="menu-modal-list-title">{t("nav.logOut")}</div>
            <div className="menu-modal-list-sub">{t("settings.logoutHint")}</div>
          </div>
          <div className="menu-modal-list-actions">
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
      </section>
    </MenuModal>
  );
}
