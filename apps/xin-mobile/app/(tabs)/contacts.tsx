import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { formatApiError } from "@qchat/i18n";
import { Avatar } from "../../src/components/Avatar";
import { useChat } from "../../src/context/ChatContext";
import { useLocale } from "../../src/context/LocaleContext";
import { api, asList } from "../../src/lib/api";
import { Friend } from "../../src/lib/types";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../../src/theme";

type Row =
  | { kind: "header"; title: string; key: string }
  | { kind: "incoming"; friend: Friend }
  | { kind: "friend"; friend: Friend }
  | { kind: "blocked"; friend: Friend };

function friendName(f: Friend): string {
  return f.note || f.nickname || f.username || "Unknown";
}

export default function ContactsScreen() {
  const { openDM, friends, loadFriends, presenceByUser, unblockUser, subscribeEvents } =
    useChat();
  const { t } = useLocale();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [phoneOrUser, setPhoneOrUser] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      await loadFriends();
      setError(null);
    } catch (e: unknown) {
      setError(formatApiError(e, t, "api.err.loadFailed"));
    }
  }, [loadFriends, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribeEvents((type) => {
      if (type === "friend.request" || type === "friend.updated" || type === "friend.accepted" || type === "friend.blocked") {
        void loadFriends().catch(() => {});
      }
    });
  }, [subscribeEvents, loadFriends]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: Friend) => {
      if (!q) return true;
      return (
        friendName(f).toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q) ||
        (f.note || "").toLowerCase().includes(q)
      );
    };
    const incoming = friends
      .filter((f) => f.status === "pending" && f.incoming)
      .filter(match);
    const accepted = friends
      .filter((f) => f.status === "accepted")
      .filter(match)
      .sort((a, b) => friendName(a).localeCompare(friendName(b)));
    const blocked = friends
      .filter((f) => f.status === "blocked")
      .filter(match)
      .sort((a, b) => friendName(a).localeCompare(friendName(b)));

    const out: Row[] = [];
    if (incoming.length > 0) {
      out.push({ kind: "header", title: "Friend requests", key: "hdr-req" });
      for (const f of incoming) out.push({ kind: "incoming", friend: f });
    }
    out.push({
      kind: "header",
      title: accepted.length ? `Friends (${accepted.length})` : "Friends",
      key: "hdr-friends",
    });
    for (const f of accepted) out.push({ kind: "friend", friend: f });
    if (blocked.length > 0) {
      out.push({
        kind: "header",
        title: `Blocked (${blocked.length})`,
        key: "hdr-blocked",
      });
      for (const f of blocked) out.push({ kind: "blocked", friend: f });
    }
    return out;
  }, [friends, query]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  async function requestFriend() {
    setBusy(true);
    try {
      const q = phoneOrUser.trim();
      if (!q) throw new Error("Enter a username or phone number");
      const look = await api<any>(`/v1/users/lookup?q=${encodeURIComponent(q)}`);
      const users = asList(look, "users");
      if (users.length === 0) throw new Error(t("api.err.userNotFound"));
      const u = users[0];
      await api("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ user_id: u.id, message: "Hi!" }),
      });
      setAddOpen(false);
      setPhoneOrUser("");
      await load();
      Alert.alert(t("common.saved"), t("contacts.requestSent"));
    } catch (e: unknown) {
      Alert.alert(t("common.error"), formatApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: Friend) {
    try {
      await api(`/v1/friends/${f.friendshipId}/accept`, { method: "POST" });
      await load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), formatApiError(e, t));
    }
  }

  async function reject(f: Friend) {
    try {
      await api(`/v1/friends/${f.friendshipId}/reject`, { method: "POST" });
      await load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), formatApiError(e, t));
    }
  }

  async function openChat(f: Friend) {
    try {
      const id = await openDM(f.userId);
      router.push(`/chat/${id}`);
    } catch (e: unknown) {
      Alert.alert(t("common.error"), formatApiError(e, t));
    }
  }

  async function onUnblock(f: Friend) {
    setBusy(true);
    try {
      await unblockUser(f.friendshipId || f.userId);
      await load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), formatApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  function isOnline(f: Friend): boolean {
    return Boolean(presenceByUser[f.userId]?.online ?? f.online);
  }

  const hasPeople = friends.some(
    (f) =>
      f.status === "accepted" ||
      f.status === "blocked" ||
      (f.status === "pending" && f.incoming)
  );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          placeholder="Search friends"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        <Pressable style={styles.addBtn} onPress={() => setAddOpen(true)}>
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) =>
          item.kind === "header"
            ? item.key
            : item.friend.friendshipId || item.friend.userId
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {hasPeople
              ? "No matches"
              : "No contacts yet. Tap Add to find someone by phone or username, then message them."}
          </Text>
        }
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return (
              <View style={styles.section}>
                <Text style={styles.sectionText}>{item.title}</Text>
              </View>
            );
          }
          const f = item.friend;
          const name = friendName(f);
          if (item.kind === "incoming") {
            return (
              <View style={styles.row}>
                <Avatar name={name} url={f.avatarUrl} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.sub}>@{f.username} · Friend request</Text>
                </View>
                <Pressable style={styles.accept} onPress={() => accept(f)}>
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
                <Pressable style={styles.reject} onPress={() => reject(f)}>
                  <Text style={styles.rejectText}>Decline</Text>
                </Pressable>
              </View>
            );
          }
          if (item.kind === "blocked") {
            return (
              <View style={styles.row}>
                <Avatar name={name} url={f.avatarUrl} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.sub}>@{f.username} · Blocked</Text>
                </View>
                <Pressable
                  style={styles.unblock}
                  onPress={() => onUnblock(f)}
                  disabled={busy}
                >
                  <Text style={styles.unblockText}>Unblock</Text>
                </Pressable>
              </View>
            );
          }
          return (
            <Pressable style={styles.row} onPress={() => openChat(f)}>
              <View style={styles.avatarWrap}>
                <Avatar name={name} url={f.avatarUrl} />
                {isOnline(f) ? <View style={styles.onlineDot} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.sub}>@{f.username}</Text>
              </View>
              <Text style={styles.messageHint}>Message</Text>
            </Pressable>
          );
        }}
      />

      <Modal visible={addOpen} transparent animationType="fade">
        <Pressable style={styles.modalBg} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Add friend</Text>
            <TextInput
              style={styles.input}
              placeholder="Phone or username"
              placeholderTextColor={colors.textMuted}
              value={phoneOrUser}
              onChangeText={setPhoneOrUser}
              autoCapitalize="none"
            />
            <Pressable style={styles.primary} onPress={requestFriend} disabled={busy}>
              <Text style={styles.primaryText}>{busy ? "…" : "Send request"}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: c.bg },
  toolbar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  search: {
    flex: 1,
    backgroundColor: c.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
    color: c.text,
  },
  addBtn: {
    backgroundColor: c.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 13 },
  section: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: c.bg,
  },
  sectionText: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  error: { color: c.danger, padding: spacing.md },
  empty: {
    textAlign: "center" as const,
    color: c.textSecondary,
    marginTop: 48,
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  avatarWrap: { position: "relative" as const },
  onlineDot: {
    position: "absolute" as const,
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: c.online,
    borderWidth: 2,
    borderColor: c.surface,
  },
  name: { fontSize: 16, fontWeight: "600" as const, color: c.text },
  sub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  messageHint: { fontSize: 13, color: c.accent, fontWeight: "600" as const },
  accept: {
    backgroundColor: c.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  acceptText: { color: "#fff", fontWeight: "600" as const, fontSize: 13 },
  reject: {
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  rejectText: { color: c.textSecondary, fontSize: 13 },
  unblock: {
    backgroundColor: c.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  unblockText: { color: c.accent, fontWeight: "600" as const, fontSize: 13 },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center" as const,
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  modalTitle: { fontSize: 18, fontWeight: "700" as const, marginBottom: spacing.md, color: c.text },
  input: {
    backgroundColor: c.inputBg,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: c.text,
    marginBottom: spacing.md,
  },
  primary: {
    backgroundColor: c.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center" as const,
  },
  primaryText: { color: "#fff", fontWeight: "700" as const },
};
}
