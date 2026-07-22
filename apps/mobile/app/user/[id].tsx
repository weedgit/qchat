/**
 * Other-user profile (Mattermost user profile / popover).
 * GET /v1/users/{id} respects profile_visibility.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Avatar } from "../../src/components/Avatar";
import { useChat } from "../../src/context/ChatContext";
import { api } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";

type UserProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  real_name?: string;
  age?: number | null;
  region?: string;
  signature?: string;
  friend_privacy?: string;
  profile_visibility?: string;
  friendship_id?: string;
  friendship_status?: string;
  is_friend?: boolean;
  online?: boolean;
  last_active_at?: string;
  note?: string;
  tags?: string[];
};

function formatLastSeen(iso?: string): string {
  if (!iso) return "Offline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Offline";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return "Last seen just now";
  if (sec < 3600) return `Last seen ${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `Last seen ${Math.floor(sec / 3600)}h ago`;
  return `Last seen ${d.toLocaleString()}`;
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = String(id);
  const { openDM } = useChat();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api<any>(`/v1/users/${userId}`);
      setProfile({
        id: String(u?.id ?? userId),
        username: String(u?.username ?? ""),
        display_name: String(u?.display_name ?? u?.username ?? "User"),
        avatar_url: u?.avatar_url || undefined,
        real_name: u?.real_name != null ? String(u.real_name) : undefined,
        age: typeof u?.age === "number" ? u.age : u?.age == null ? null : undefined,
        region: u?.region != null ? String(u.region) : undefined,
        signature: u?.signature != null ? String(u.signature) : undefined,
        friend_privacy: String(u?.friend_privacy ?? ""),
        profile_visibility: String(u?.profile_visibility ?? ""),
        friendship_id: u?.friendship_id ? String(u.friendship_id) : undefined,
        friendship_status: u?.friendship_status ? String(u.friendship_status) : undefined,
        is_friend: Boolean(u?.is_friend),
        online: Boolean(u?.online),
        last_active_at: u?.last_active_at ? String(u.last_active_at) : undefined,
        note: u?.note ? String(u.note) : undefined,
        tags: Array.isArray(u?.tags) ? u.tags.map(String) : undefined,
      });
    } catch (e: any) {
      setError(e?.message || "Could not load user");
      setProfile(null);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const displayName = profile?.note || profile?.display_name || "User";

  async function onMessage() {
    if (!profile) return;
    setBusy(true);
    try {
      const convId = await openDM(profile.id);
      router.replace({ pathname: "/chat/[id]", params: { id: convId } });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not open chat");
    } finally {
      setBusy(false);
    }
  }

  async function onAddFriend() {
    if (!profile) return;
    if (profile.friend_privacy === "closed") {
      Alert.alert("Unavailable", "This user is not accepting friend requests.");
      return;
    }
    setBusy(true);
    try {
      await api("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ username: profile.username }),
      });
      Alert.alert("Sent", "Friend request sent.");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  const canAddFriend =
    profile &&
    !profile.is_friend &&
    profile.friendship_status !== "pending" &&
    profile.friendship_status !== "blocked";

  return (
    <>
      <Stack.Screen options={{ title: "User info" }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!profile && !error ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : null}
        {profile ? (
          <>
            <View style={styles.hero}>
              <Avatar name={displayName} url={profile.avatar_url} size={96} />
              <Text style={styles.name}>{displayName}</Text>
              {profile.note ? (
                <Text style={styles.sub}>{profile.display_name}</Text>
              ) : null}
              <Text style={styles.sub}>@{profile.username}</Text>
              <Text style={styles.presence}>
                {profile.online ? "Online" : formatLastSeen(profile.last_active_at)}
              </Text>
              {profile.tags && profile.tags.length > 0 ? (
                <View style={styles.tagRow}>
                  {profile.tags.map((t) => (
                    <Text key={t} style={styles.tag}>
                      #{t}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Pressable style={styles.primaryBtn} onPress={onMessage} disabled={busy}>
                <Text style={styles.primaryBtnText}>Message</Text>
              </Pressable>
              {canAddFriend ? (
                <Pressable style={styles.secondaryBtn} onPress={onAddFriend} disabled={busy}>
                  <Text style={styles.secondaryBtnText}>Add friend</Text>
                </Pressable>
              ) : null}
              {profile.friendship_status === "pending" ? (
                <Text style={styles.hint}>Friend request pending</Text>
              ) : null}
              {profile.is_friend ? <Text style={styles.hint}>Friends</Text> : null}
            </View>

            <View style={styles.card}>
              {profile.signature != null ? (
                <Row label="Signature" value={profile.signature || "—"} />
              ) : null}
              {profile.real_name != null ? (
                <Row label="Real name" value={profile.real_name || "—"} />
              ) : null}
              {profile.age !== undefined ? (
                <Row label="Age" value={profile.age == null ? "—" : String(profile.age)} />
              ) : null}
              {profile.region != null ? (
                <Row label="Region" value={profile.region || "—"} />
              ) : null}
              {profile.signature == null &&
              profile.real_name == null &&
              profile.age === undefined &&
              profile.region == null ? (
                <Text style={styles.hint}>
                  Full profile is visible to friends
                  {profile.profile_visibility === "friends" ? " only" : ""}.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
  error: { color: colors.danger, padding: spacing.sm },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  name: { fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" },
  sub: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
  presence: { fontSize: 13, color: colors.online, marginTop: 2 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  tag: {
    backgroundColor: colors.inputBg,
    color: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    fontSize: 12,
    overflow: "hidden",
  },
  actions: { gap: spacing.sm },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  secondaryBtnText: { color: colors.accent, fontWeight: "700", fontSize: 16 },
  hint: { textAlign: "center", color: colors.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 10,
  },
  row: { gap: 2 },
  rowLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "500" },
  rowValue: { color: colors.text, fontSize: 15 },
});
