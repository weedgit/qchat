/**
 * profile hub (mirror web apps/web/src/app/profile/page.tsx).
 * Notifications / sessions / sign-out live on the Settings tab.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "../../src/components/Avatar";
import { UserQr } from "../../src/components/UserQr";
import { useAuth } from "../../src/context/AuthContext";
import { useLocale } from "../../src/context/LocaleContext";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { api, uploadMedia } from "../../src/lib/api";
import { displayNameError, isValidUsername } from "../../src/lib/credentials";
import type { PresenceStatus } from "../../src/lib/types";
import { radius, spacing, type ColorTokens } from "../../src/theme";

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
  enterprise_id: string;
  enterprise_name: string;
};

const STATUS_OPTIONS: { value: PresenceStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "dnd", label: "Do not disturb" },
  { value: "offline", label: "Appear offline" },
];

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
    enterprise_id: String(u?.enterprise_id ?? "").trim(),
    enterprise_name: String(u?.enterprise_name ?? "").trim(),
  };
}

export default function MeScreen() {
  const { user, refreshMe, setMyStatus } = useAuth();
  const { colors } = useTheme();
  const { t } = useLocale();
  const styles = useThemedStyles(makeStyles);
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const initialUsernameRef = useRef("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api<any>("/v1/me");
      const mapped = mapProfile(u);
      setMe(mapped);
      initialUsernameRef.current = mapped.username.trim();
      setUsernameTaken(false);
      await refreshMe().catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Could not load profile");
    }
  }, [refreshMe]);

  useEffect(() => {
    load();
  }, [load]);

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
    const timer = setTimeout(() => {
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
      clearTimeout(timer);
    };
  }, [me?.username]);

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
    const dnErr = displayNameError(me.display_name);
    if (dnErr) {
      setError(dnErr);
      return;
    }
    const username = me.username.trim();
    if (!isValidUsername(username)) {
      setError("Username must be 2–32 letters, digits, or underscores");
      return;
    }
    if (usernameTaken) {
      setError("That username is already taken");
      return;
    }
    setSaving(true);
    setSaved(false);
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

  function pickStatus() {
    Alert.alert(
      "Status",
      undefined,
      [
        ...STATUS_OPTIONS.map((opt) => ({
          text: opt.label,
          onPress: () => {
            setMyStatus(opt.value).catch((e: any) =>
              Alert.alert("Error", e?.message || "Could not update status")
            );
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }

  const visibilityLabel =
    me?.profile_visibility === "public" ? "Public" : "Friends only";
  const friendLabel =
    me?.friend_privacy === "open"
      ? "Anyone can add me"
      : me?.friend_privacy === "closed"
        ? "Nobody can add me"
        : "Need my approval";
  const statusLabel =
    STATUS_OPTIONS.find((o) => o.value === (user?.status || "online"))?.label || "Online";
  const enterpriseLabel = me?.enterprise_id
    ? me.enterprise_name
      ? `Enterprise · ${me.enterprise_name}`
      : "Enterprise"
    : null;

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
          <Avatar name={me?.display_name || t("me.title")} url={me?.avatar_url || undefined} size={72} />
          <View style={styles.avatarBadge}>
            <Ionicons name="camera" size={14} color="#fff" />
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name}>{me?.display_name || t("common.loading")}</Text>
          <Text style={styles.sub}>
            @{me?.username || "—"} · {me?.phone || "—"}
          </Text>
          {enterpriseLabel ? (
            <Text style={styles.enterprise}>{enterpriseLabel}</Text>
          ) : null}
          <Text style={styles.idLine}>ID: {me?.id || "—"}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <SelectRow
          label="Status"
          value={statusLabel}
          onPress={pickStatus}
          styles={styles}
          colors={colors}
        />
      </View>

      {me ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("me.editProfile")}</Text>
          <Field
            label="Username"
            value={me.username}
            onChangeText={(text) => setMe({ ...me, username: text })}
            hint={usernameTaken ? "Username is taken" : undefined}
            styles={styles}
            colors={colors}
          />
          {usernameTaken ? <Text style={styles.fieldError}>Username is taken</Text> : null}
          <Field
            label="Phone (login ID)"
            value={me.phone}
            editable={false}
            hint="Change in Settings"
            styles={styles}
            colors={colors}
          />
          <Field
            label="Display name"
            value={me.display_name}
            onChangeText={(text) => setMe({ ...me, display_name: text })}
            styles={styles}
            colors={colors}
          />
          <Field
            label="Real name"
            value={me.real_name}
            onChangeText={(text) => setMe({ ...me, real_name: text })}
            styles={styles}
            colors={colors}
          />
          <Field
            label="Age"
            value={me.age == null ? "" : String(me.age)}
            keyboardType="number-pad"
            onChangeText={(text) =>
              setMe({ ...me, age: text.trim() === "" ? null : Number(text) || null })
            }
            styles={styles}
            colors={colors}
          />
          <Field
            label="Region"
            value={me.region}
            onChangeText={(text) => setMe({ ...me, region: text })}
            styles={styles}
            colors={colors}
          />
          <Field
            label="Role"
            value={me.signature}
            onChangeText={(text) => setMe({ ...me, signature: text })}
            styles={styles}
            colors={colors}
          />
          <SelectRow label="Profile visibility" value={visibilityLabel} onPress={pickVisibility} styles={styles} colors={colors} />
          <SelectRow label="Friend requests" value={friendLabel} onPress={pickFriendPrivacy} styles={styles} colors={colors} />
          <Pressable
            style={[styles.primaryBtn, usernameTaken && styles.btnDisabled]}
            onPress={onSaveProfile}
            disabled={saving || usernameTaken}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t("common.save")}</Text>
            )}
          </Pressable>
          {saved ? <Text style={styles.hint}>{t("common.saved")}</Text> : null}
        </View>
      ) : (
        <View style={styles.card}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {me?.username ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>My QR code</Text>
          <Text style={styles.cardHint}>Others can scan this to find your profile.</Text>
          <UserQr username={me.username} size={180} />
        </View>
      ) : null}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Field({
  label,
  hint,
  styles,
  colors,
  ...props
}: {
  label: string;
  hint?: string;
  styles: Styles;
  colors: ColorTokens;
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
  styles,
  colors,
}: {
  label: string;
  value: string;
  onPress: () => void;
  styles: Styles;
  colors: ColorTokens;
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

function makeStyles(c: ColorTokens) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
    error: {
      color: c.danger,
      backgroundColor: "#fef2f2",
      padding: spacing.md,
      borderRadius: radius.md,
      overflow: "hidden" as const,
    },
    hero: {
      backgroundColor: c.headerBlue,
      borderRadius: radius.lg,
      padding: spacing.lg,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.md,
    },
    avatarBtn: { position: "relative" as const },
    avatarBadge: {
      position: "absolute" as const,
      right: -2,
      bottom: -2,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 2,
      borderColor: c.headerBlue,
    },
    name: { color: "#fff", fontSize: 20, fontWeight: "700" as const },
    sub: { color: "rgba(255,255,255,0.85)", marginTop: 2, fontSize: 13 },
    enterprise: { color: "rgba(255,255,255,0.95)", marginTop: 4, fontSize: 12, fontWeight: "600" as const },
    idLine: { color: "rgba(255,255,255,0.7)", marginTop: 4, fontSize: 11 },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 10,
    },
    cardTitle: { fontSize: 16, fontWeight: "700" as const, color: c.text },
    cardHint: { fontSize: 12, color: c.textMuted, marginTop: -4 },
    field: { gap: 4 },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: "500" as const },
    input: {
      backgroundColor: c.inputBg,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      fontSize: 15,
      color: c.text,
    },
    inputDisabled: { color: c.textMuted },
    fieldHint: { fontSize: 11, color: c.textMuted },
    fieldError: { fontSize: 12, color: c.danger, marginTop: -6 },
    selectRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm,
      paddingVertical: 6,
    },
    selectValue: { color: c.text, fontSize: 15, marginTop: 2 },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.sm,
      paddingVertical: 12,
      alignItems: "center" as const,
      marginTop: 4,
    },
    btnDisabled: { opacity: 0.45 },
    primaryBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
    hint: { color: c.textSecondary, fontSize: 13 },
  };
}
