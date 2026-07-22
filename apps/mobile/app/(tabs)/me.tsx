/**
 * Mattermost-style profile hub (mirror web apps/web/src/app/profile/page.tsx).
 * Notifications / sessions / sign-out live on the Settings tab.
 */
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "../../src/components/Avatar";
import { useAuth } from "../../src/context/AuthContext";
import { api, uploadMedia } from "../../src/lib/api";
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
  const { refreshMe } = useAuth();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api<any>("/v1/me");
      setMe(mapProfile(u));
      await refreshMe().catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Could not load profile");
    }
  }, [refreshMe]);

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

  const visibilityLabel =
    me?.profile_visibility === "public" ? "Public" : "Friends only";
  const friendLabel =
    me?.friend_privacy === "open"
      ? "Anyone can add me"
      : me?.friend_privacy === "closed"
        ? "Nobody can add me"
        : "Need my approval";

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
          <Field
            label="Phone (login ID)"
            value={me.phone}
            editable={false}
            hint="Change in Settings"
          />
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
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  hint: { color: colors.textSecondary, fontSize: 13 },
});
