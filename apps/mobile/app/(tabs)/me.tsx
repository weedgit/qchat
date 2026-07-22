/**
 * Mattermost-style profile / settings hub (mirror web apps/web/src/app/profile/page.tsx).
 */
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Avatar } from "../../src/components/Avatar";
import { useAuth } from "../../src/context/AuthContext";
import { api, apiBaseUrl, uploadMedia } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";

type Profile = {
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
};

type NotifyProps = {
  desktop: "all" | "mention" | "none";
  sound: boolean;
  mentions_only: boolean;
};

type LoginSession = {
  id: string;
  device_type: string;
  device_name: string;
  platform: string;
  location: string;
  current?: boolean;
  created_at: string;
  last_active_at: string;
};

function formatSessionActive(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleString();
}

function sessionTitle(s: LoginSession): string {
  const platform = s.platform.trim();
  if (
    platform &&
    !["web", "desktop", "phone", "mobile", "browser"].includes(platform.toLowerCase())
  ) {
    return platform;
  }
  if (s.device_name && s.device_name.toLowerCase() !== "web") return s.device_name;
  if (s.device_type === "phone") return "Mobile";
  if (s.device_type === "desktop") return "Desktop";
  return "Web";
}

function mapProfile(u: any): Profile {
  return {
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
  };
}

export default function MeScreen() {
  const { refreshMe, signOut } = useAuth();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notify, setNotify] = useState<NotifyProps>({
    desktop: "all",
    sound: true,
    mentions_only: false,
  });
  const [notifySaved, setNotifySaved] = useState(false);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [phoneHint, setPhoneHint] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const rows = await api<any>("/v1/me/sessions");
      const list = Array.isArray(rows) ? rows : [];
      setSessions(
        list.map((s: any) => ({
          id: String(s?.id ?? ""),
          device_type: String(s?.device_type ?? ""),
          device_name: String(s?.device_name ?? ""),
          platform: String(s?.platform ?? s?.device_name ?? ""),
          location: String(s?.location ?? s?.ip_region ?? s?.ip ?? ""),
          current: Boolean(s?.current),
          created_at: String(s?.created_at ?? ""),
          last_active_at: String(s?.last_active_at ?? s?.created_at ?? ""),
        }))
      );
    } catch {
      setSessions([]);
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api<any>("/v1/me");
      setMe(mapProfile(u));
      await refreshMe().catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Could not load profile");
    }
    try {
      const p = await api<any>("/v1/me/notify_props");
      setNotify({
        desktop: p?.desktop === "mention" || p?.desktop === "none" ? p.desktop : "all",
        sound: p?.sound !== false,
        mentions_only: Boolean(p?.mentions_only),
      });
    } catch {
      /* keep defaults */
    }
    await loadSessions();
  }, [loadSessions, refreshMe]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function pickAvatar() {
    if (!me || saving) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to change your avatar.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const name = a.fileName || `avatar.${(a.uri.split(".").pop() || "jpg").split("?")[0]}`;
    setSaving(true);
    setError(null);
    try {
      const up = await uploadMedia(a.uri, "avatar", name, a.mimeType || "image/jpeg");
      const url = String(up.url || "");
      await api("/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ avatar_url: url }),
      });
      setMe({ ...me, avatar_url: url });
      await refreshMe();
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || "Avatar upload failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveProfile() {
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
    } catch (e: any) {
      setError(e?.message || "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveNotify() {
    setSaving(true);
    setNotifySaved(false);
    setError(null);
    try {
      await api("/v1/me/notify_props", {
        method: "PUT",
        body: JSON.stringify(notify),
      });
      setNotifySaved(true);
    } catch (e: any) {
      setError(e?.message || "Could not save notifications");
    } finally {
      setSaving(false);
    }
  }

  async function revokeSession(s: LoginSession) {
    const label = s.current ? "Sign out of this device?" : "Revoke this session?";
    Alert.alert(s.current ? "Sign out" : "Revoke session", label, [
      { text: "Cancel", style: "cancel" },
      {
        text: s.current ? "Sign out" : "Revoke",
        style: "destructive",
        onPress: async () => {
          setSessionsBusy(true);
          setError(null);
          try {
            await api(`/v1/me/sessions/${s.id}`, { method: "DELETE" });
            if (s.current) {
              await signOut();
              router.replace("/login");
              return;
            }
            await loadSessions();
          } catch (e: any) {
            setError(e?.message || "Could not revoke session");
          } finally {
            setSessionsBusy(false);
          }
        },
      },
    ]);
  }

  async function requestPhoneChange() {
    if (newPhone.length !== 11) return;
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
    } catch (e: any) {
      setPhoneHint(e?.message || "Could not send SMS");
    } finally {
      setSaving(false);
    }
  }

  async function confirmPhoneChange() {
    if (!me || !phoneCode) return;
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
      await refreshMe();
    } catch (e: any) {
      setPhoneHint(e?.message || "Could not confirm phone");
    } finally {
      setSaving(false);
    }
  }

  function onLogout() {
    Alert.alert("Sign out", "Sign out of this account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/login");
        },
      },
    ]);
  }

  function pickVisibility() {
    if (!me) return;
    Alert.alert("Profile visibility", undefined, [
      {
        text: "Public",
        onPress: () => setMe({ ...me, profile_visibility: "public" }),
      },
      {
        text: "Friends only",
        onPress: () => setMe({ ...me, profile_visibility: "friends" }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function pickFriendPrivacy() {
    if (!me) return;
    Alert.alert("Friend requests", undefined, [
      {
        text: "Anyone can add me",
        onPress: () => setMe({ ...me, friend_privacy: "open" }),
      },
      {
        text: "Need my approval",
        onPress: () => setMe({ ...me, friend_privacy: "approval" }),
      },
      {
        text: "Nobody can add me",
        onPress: () => setMe({ ...me, friend_privacy: "closed" }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function pickDesktopNotify() {
    Alert.alert("Notifications", undefined, [
      {
        text: "All new messages",
        onPress: () => setNotify({ ...notify, desktop: "all" }),
      },
      {
        text: "Mentions only",
        onPress: () => setNotify({ ...notify, desktop: "mention" }),
      },
      {
        text: "Nothing",
        onPress: () => setNotify({ ...notify, desktop: "none" }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const visibilityLabel =
    me?.profile_visibility === "public" ? "Public" : "Friends only";
  const friendLabel =
    me?.friend_privacy === "open"
      ? "Anyone can add me"
      : me?.friend_privacy === "closed"
        ? "Nobody can add me"
        : "Need my approval";
  const desktopLabel =
    notify.desktop === "mention"
      ? "Mentions only"
      : notify.desktop === "none"
        ? "Nothing"
        : "All new messages";

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.hero}>
        <Pressable onPress={pickAvatar} disabled={saving || !me} style={styles.avatarBtn}>
          <Avatar name={me?.display_name || "Me"} url={me?.avatar_url || undefined} size={72} />
          <View style={styles.avatarBadge}>
            <Ionicons name="camera" size={14} color="#fff" />
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name}>{me?.display_name || "Loading…"}</Text>
          <Text style={styles.sub}>
            @{me?.username || "—"} · {me?.phone || "—"}
          </Text>
          <Text style={styles.idLine}>ID: {me?.id || "—"}</Text>
        </View>
      </View>

      {me ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Edit profile</Text>
          <Field label="Username" value={me.username} editable={false} hint="Set at registration" />
          <Field label="Phone (login ID)" value={me.phone} editable={false} hint="Change with SMS below" />
          <Field
            label="Display name"
            value={me.display_name}
            onChangeText={(t) => setMe({ ...me, display_name: t })}
          />
          <Field
            label="Real name"
            value={me.real_name}
            onChangeText={(t) => setMe({ ...me, real_name: t })}
          />
          <Field
            label="Age"
            value={me.age == null ? "" : String(me.age)}
            keyboardType="number-pad"
            onChangeText={(t) =>
              setMe({ ...me, age: t.trim() === "" ? null : Number(t) || null })
            }
          />
          <Field
            label="Region"
            value={me.region}
            onChangeText={(t) => setMe({ ...me, region: t })}
          />
          <Field
            label="Signature"
            value={me.signature}
            onChangeText={(t) => setMe({ ...me, signature: t })}
          />
          <SelectRow label="Profile visibility" value={visibilityLabel} onPress={pickVisibility} />
          <SelectRow label="Friend requests" value={friendLabel} onPress={pickFriendPrivacy} />
          <Pressable style={styles.primaryBtn} onPress={onSaveProfile} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Save changes</Text>
            )}
          </Pressable>
          {saved ? <Text style={styles.hint}>Saved</Text> : null}
        </View>
      ) : (
        <View style={styles.card}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {me ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notifications</Text>
          <Text style={styles.cardHint}>Mattermost-style notify preferences</Text>
          <SelectRow label="Desktop notifications" value={desktopLabel} onPress={pickDesktopNotify} />
          <ToggleRow
            label="Play notification sound"
            value={notify.sound}
            onValueChange={(v) => setNotify({ ...notify, sound: v })}
          />
          <ToggleRow
            label="Mentions only"
            value={notify.mentions_only}
            onValueChange={(v) => setNotify({ ...notify, mentions_only: v })}
          />
          <Pressable style={styles.primaryBtn} onPress={onSaveNotify} disabled={saving}>
            <Text style={styles.primaryBtnText}>Save notifications</Text>
          </Pressable>
          {notifySaved ? <Text style={styles.hint}>Saved</Text> : null}
        </View>
      ) : null}

      {me ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Login sessions</Text>
          <Text style={styles.cardHint}>
            One web, one desktop, and one phone session. Location is estimated from IP.
          </Text>
          {sessions.length === 0 ? (
            <Text style={styles.muted}>No active sessions.</Text>
          ) : (
            sessions.map((s) => (
              <View key={s.id} style={styles.sessionRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sessionTitle}>
                    {sessionTitle(s)}
                    {s.current ? " · This device" : ""}
                  </Text>
                  <Text style={styles.muted}>{s.location || "Unknown location"}</Text>
                  <Text style={styles.mutedSmall}>
                    Last active {formatSessionActive(s.last_active_at || s.created_at)}
                  </Text>
                </View>
                <Pressable
                  style={styles.ghostBtn}
                  disabled={sessionsBusy}
                  onPress={() => revokeSession(s)}
                >
                  <Text style={styles.ghostBtnText}>{s.current ? "Sign out" : "Revoke"}</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      ) : null}

      {me ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change phone number</Text>
          <Field
            label="New 11-digit phone"
            value={newPhone}
            onChangeText={setNewPhone}
            keyboardType="phone-pad"
            maxLength={11}
          />
          {!challengeId ? (
            <Pressable
              style={[styles.primaryBtn, newPhone.length !== 11 && styles.btnDisabled]}
              onPress={requestPhoneChange}
              disabled={saving || newPhone.length !== 11}
            >
              <Text style={styles.primaryBtnText}>Send SMS code</Text>
            </Pressable>
          ) : (
            <>
              <Field
                label="Verification code"
                value={phoneCode}
                onChangeText={setPhoneCode}
                keyboardType="number-pad"
              />
              <Pressable
                style={[styles.primaryBtn, !phoneCode && styles.btnDisabled]}
                onPress={confirmPhoneChange}
                disabled={saving || !phoneCode}
              >
                <Text style={styles.primaryBtnText}>Confirm phone change</Text>
              </Pressable>
            </>
          )}
          {phoneHint ? <Text style={styles.hint}>{phoneHint}</Text> : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>API server</Text>
        <Text style={styles.muted}>{apiBaseUrl()}</Text>
      </View>

      <Pressable style={styles.logout} onPress={onLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: string;
} & ComponentProps<typeof TextInput>) {
  const editable = props.editable !== false;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function SelectRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.selectRow} onPress={onPress}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.selectValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
  error: {
    color: colors.danger,
    backgroundColor: "#fef2f2",
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  hero: {
    backgroundColor: colors.headerBlue,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatarBtn: { position: "relative" },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.headerBlue,
  },
  name: { color: "#fff", fontSize: 20, fontWeight: "700" },
  sub: { color: "rgba(255,255,255,0.85)", marginTop: 2, fontSize: 13 },
  idLine: { color: "rgba(255,255,255,0.7)", marginTop: 4, fontSize: 11 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  cardHint: { fontSize: 12, color: colors.textMuted, marginTop: -4 },
  field: { gap: 4 },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: "500" },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  inputDisabled: { color: colors.textMuted },
  fieldHint: { fontSize: 11, color: colors.textMuted },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  selectValue: { color: colors.text, fontSize: 15, marginTop: 2 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 4,
  },
  toggleLabel: { flex: 1, color: colors.text, fontSize: 15 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  hint: { color: colors.textSecondary, fontSize: 13 },
  muted: { color: colors.textSecondary, fontSize: 13 },
  mutedSmall: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sessionTitle: { fontWeight: "600", color: colors.text, fontSize: 14 },
  ghostBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.inputBg,
  },
  ghostBtnText: { color: colors.accent, fontWeight: "600", fontSize: 13 },
  logout: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  logoutText: { color: colors.danger, fontWeight: "600", fontSize: 16 },
});
