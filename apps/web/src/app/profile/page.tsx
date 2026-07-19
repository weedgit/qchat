"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { api, clearToken, API_URL } from "@/lib/api";

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

  useEffect(() => {
    load();
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
                {API_URL}
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
              onClick={() => {
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
