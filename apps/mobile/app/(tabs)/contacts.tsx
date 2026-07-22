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

export default function ContactsScreen() {
  const { openDM } = useChat();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const accepted = useMemo(
    () => friends.filter((f) => f.status === "accepted"),
    [friends]
  );
  const incoming = useMemo(
    () => friends.filter((f) => f.status === "pending" && f.incoming),
    [friends]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  async function requestFriend() {
    setBusy(true);
    try {
      const q = phoneOrUser.trim();
      if (!q) throw new Error("输入用户名或手机号");
      const look = await api<any>(`/v1/users/lookup?q=${encodeURIComponent(q)}`);
      const users = asList(look, "users");
      if (users.length === 0) throw new Error("未找到用户");
      const u = users[0];
      await api("/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ user_id: u.id, message: "Hi!" }),
      });
      setAddOpen(false);
      setPhoneOrUser("");
      await load();
      Alert.alert("已发送", "好友请求已发送");
    } catch (e: any) {
      Alert.alert("失败", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: Friend) {
    await api(`/v1/friends/${f.friendshipId}/accept`, { method: "POST" });
    await load();
  }

  async function reject(f: Friend) {
    await api(`/v1/friends/${f.friendshipId}/reject`, { method: "POST" });
    await load();
  }

  async function openChat(f: Friend) {
    try {
      const id = await openDM(f.userId);
      router.push(`/chat/${id}`);
    } catch (e: any) {
      Alert.alert("失败", e.message);
    }
  }

  return (
    <View style={styles.root}>
      <Pressable style={styles.addBar} onPress={() => setAddOpen(true)}>
        <Text style={styles.addBarText}>＋ 添加好友</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={[
          ...incoming.map((f) => ({ kind: "incoming" as const, friend: f })),
          ...accepted.map((f) => ({ kind: "friend" as const, friend: f })),
        ]}
        keyExtractor={(item) => item.friend.friendshipId || item.friend.userId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>暂无联系人</Text>}
        renderItem={({ item }) => {
          const f = item.friend;
          const name = f.note || f.nickname || f.username;
          if (item.kind === "incoming") {
            return (
              <View style={styles.row}>
                <Avatar name={name} url={f.avatarUrl} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.sub}>好友请求</Text>
                </View>
                <Pressable style={styles.accept} onPress={() => accept(f)}>
                  <Text style={styles.acceptText}>接受</Text>
                </Pressable>
                <Pressable style={styles.reject} onPress={() => reject(f)}>
                  <Text style={styles.rejectText}>拒绝</Text>
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
            </Pressable>
          );
        }}
      />

      <Modal visible={addOpen} transparent animationType="fade">
        <Pressable style={styles.modalBg} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>添加好友</Text>
            <TextInput
              style={styles.input}
              placeholder="手机号或用户名"
              placeholderTextColor={colors.textMuted}
              value={phoneOrUser}
              onChangeText={setPhoneOrUser}
              autoCapitalize="none"
            />
            <Pressable style={styles.primary} onPress={requestFriend} disabled={busy}>
              <Text style={styles.primaryText}>{busy ? "…" : "发送请求"}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  addBar: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  addBarText: { color: colors.accent, fontWeight: "600", fontSize: 15 },
  error: { color: colors.danger, padding: spacing.md },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: 48 },
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
