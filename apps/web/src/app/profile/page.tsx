"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
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
  const router = useRouter();
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
      current?: boolean;
      created_at: string;
      expires_at: string;
    }[]
  >([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  async function uploadAvatar(file: File) {
    if (!me) return;
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
        display_name: String(u?.display_name ?? u?.username ?? "Me"),
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
      setPushDeviceError(e.message || "Could not load notification devices");
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
          current: Boolean(s?.current),
          created_at: String(s?.created_at ?? ""),
          expires_at: String(s?.expires_at ?? ""),
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
      setError(e.message || "Could not revoke session");
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
      setPushDeviceError(e.message || "Could not remove notification device");
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
    <AppShell>
      <main className="page-pane">
        <h1>Profile</h1>

        {error && (
          <div className="card">
            <div className="error-text">Could not load/save profile: {error}</div>
          </div>
        )}

        <div className="card" style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <button
            type="button"
            className="avatar-edit"
            title="Change avatar"
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
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadAvatar(file);
            }}
          />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {me?.display_name ?? "Loading…"}
            </div>
            <div className="muted">@{me?.username || "—"} · {me?.phone || "—"}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              ID: {me?.id || "—"}
            </div>
          </div>
        </div>

        {me && (
          <form className="card" onSubmit={onSave} style={{ display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Edit profile</h2>

            <label className="field">
              <span>Username</span>
              <input value={me.username} disabled />
              <span className="muted" style={{ fontSize: 12 }}>
                Username is set at registration. Availability is checked when creating an account.
              </span>
            </label>

            <label className="field">
              <span>Phone (login ID)</span>
              <input value={me.phone} disabled />
              <span className="muted" style={{ fontSize: 12 }}>
                Change phone with SMS verification below.
              </span>
            </label>

            <label className="field">
              <span>Display name</span>
              <input
                value={me.display_name}
                onChange={(e) => setMe({ ...me, display_name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Real name</span>
              <input
                value={me.real_name}
                onChange={(e) => setMe({ ...me, real_name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Age</span>
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
              <span>Region</span>
              <input
                value={me.region}
                onChange={(e) => setMe({ ...me, region: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Signature</span>
              <input
                value={me.signature}
                onChange={(e) => setMe({ ...me, signature: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Profile visibility</span>
              <select
                value={me.profile_visibility}
                onChange={(e) => setMe({ ...me, profile_visibility: e.target.value })}
              >
                <option value="public">Public</option>
                <option value="friends">Friends only</option>
              </select>
            </label>
            <label className="field">
              <span>Friend requests</span>
              <select
                value={me.friend_privacy}
                onChange={(e) => setMe({ ...me, friend_privacy: e.target.value })}
              >
                <option value="open">Anyone can add me</option>
                <option value="approval">Need my approval</option>
                <option value="closed">Nobody can add me</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              {saved && <span className="muted">Saved</span>}
            </div>
          </form>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Notifications</h2>
            <div className="muted" style={{ fontSize: 12 }}>
              Mattermost-style desktop notify preferences
            </div>
            <label className="field">
              <span>Desktop notifications</span>
              <select
                value={notify.desktop}
                onChange={(e) =>
                  setNotify({
                    ...notify,
                    desktop: e.target.value as NotifyProps["desktop"],
                  })
                }
              >
                <option value="all">All new messages</option>
                <option value="mention">Mentions only</option>
                <option value="none">Nothing</option>
              </select>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={notify.sound}
                onChange={(e) => setNotify({ ...notify, sound: e.target.checked })}
              />
              Play notification sound
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={notify.mentions_only}
                onChange={(e) => setNotify({ ...notify, mentions_only: e.target.checked })}
              />
              Mentions only (overrides desktop when on)
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
                Save notifications
              </button>
              {notifySaved && <span className="muted">Saved</span>}
            </div>
          </div>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>Login sessions</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Each browser or desktop app has its own device id. Revoke a session to sign it out.
              </div>
            </div>
            {loginSessions.length === 0 && (
              <div className="muted">No active sessions.</div>
            )}
            {loginSessions.map((s) => (
              <div className="list-row" key={s.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {s.device_name || s.device_type || "Device"}
                    {s.current && (
                      <span className="tag-chip" style={{ marginLeft: 8 }}>
                        This device
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                    {s.device_type} · {s.device_id.slice(0, 8)}…
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Signed in {s.created_at ? new Date(s.created_at).toLocaleString() : "—"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={sessionsBusy}
                  onClick={() => revokeLoginSession(s.id, Boolean(s.current))}
                >
                  {s.current ? "Sign out" : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>Notification devices</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Remove old browsers or forwarded localhost ports that should no longer receive push.
              </div>
            </div>
            {pushDeviceError && <div className="error-text">{pushDeviceError}</div>}
            {pushDevices.length === 0 && (
              <div className="muted">No browser push subscriptions registered.</div>
            )}
            {pushDevices.map((device) => {
              const isCurrentOrigin =
                typeof window !== "undefined" && device.origin === window.location.origin;
              return (
                <div className="list-row" key={device.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {device.device_name || "Web browser"}
                      {isCurrentOrigin && (
                        <span className="tag-chip" style={{ marginLeft: 8 }}>
                          This origin
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                      {device.origin || "Older registration (origin unavailable)"}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      Last registered {new Date(device.last_seen_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pushDevicesBusy}
                    onClick={() => deletePushDevice(device)}
                  >
                    Remove
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
              Refresh devices
            </button>
          </div>
        )}

        {me && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Change phone number</h2>
            <input
              placeholder="New 11-digit phone"
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
                        ? `SMS sent (dev code: ${res.dev_code})`
                        : "SMS code sent. Enter it below."
                    );
                  } catch (err: any) {
                    setPhoneHint(err.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Send SMS code
              </button>
            ) : (
              <>
                <input
                  placeholder="Verification code"
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
                      setPhoneHint("Phone updated.");
                    } catch (err: any) {
                      setPhoneHint(err.message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Confirm phone change
                </button>
              </>
            )}
            {phoneHint && <div className="muted">{phoneHint}</div>}
          </div>
        )}

        <div className="card">
          <div className="list-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>API server</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {apiBaseUrl()}
              </div>
            </div>
          </div>
          <div className="list-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Log out</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Clears the access token on this device.
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
              Log out
            </button>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
