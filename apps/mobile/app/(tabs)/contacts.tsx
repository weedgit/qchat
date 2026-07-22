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
import { Avatar } from "../../src/components/Avatar";
import { useChat } from "../../src/context/ChatContext";
import { api, asList } from "../../src/lib/api";
import { Friend, normalizeFriend } from "../../src/lib/types";
import { colors, radius, spacing } from "../../src/theme";

type Row =
  | { kind: "header"; title: string; key: string }
  | { kind: "incoming"; friend: Friend }
  | { kind: "friend"; friend: Friend };

function friendName(f: Friend): string {
  return f.note || f.nickname || f.username || "Unknown";
}

export default function ContactsScreen() {
  const { openDM } = useChat();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [phoneOrUser, setPhoneOrUser] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<any>("/v1/friends");
      setFriends(asList(body, "friends", "users").map(normalizeFriend));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      if (users.length === 0) throw new Error("User not found");
      const u = users[0];
      await api("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ user_id: u.id, message: "Hi!" }),
      });
      setAddOpen(false);
      setPhoneOrUser("");
      await load();
      Alert.alert("Sent", "Friend request sent");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: Friend) {
    try {
      await api(`/v1/friends/${f.friendshipId}/accept`, { method: "POST" });
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  }

  async function reject(f: Friend) {
    try {
      await api(`/v1/friends/${f.friendshipId}/reject`, { method: "POST" });
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  }

  async function openChat(f: Friend) {
    try {
      const id = await openDM(f.userId);
      router.push(`/chat/${id}`);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  }

  const hasPeople = friends.some(
    (f) => f.status === "accepted" || (f.status === "pending" && f.incoming)
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
          return (
            <Pressable style={styles.row} onPress={() => openChat(f)}>
              <Avatar name={name} url={f.avatarUrl} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.sub}>@{f.username}</Text>
              </View>
              {f.online ? <View style={styles.dot} /> : null}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  search: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  section: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  error: { color: colors.danger, padding: spacing.md },
  empty: {
    textAlign: "center",
    color: colors.textSecondary,
    marginTop: 48,
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  sub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  messageHint: { fontSize: 13, color: colors.accent, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.online },
  accept: {
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  acceptText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  reject: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  rejectText: { color: colors.textSecondary, fontSize: 13 },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: spacing.md, color: colors.text },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
});
