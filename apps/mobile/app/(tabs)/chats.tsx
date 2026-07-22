import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
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
import { conversationDisplayName } from "../../src/lib/types";
import { colors, radius, spacing } from "../../src/theme";

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ChatsScreen() {
  const { conversations, loadConversations, openConversation, connected, loadError } = useChat();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = conversationDisplayName(c).toLowerCase();
      return name.includes(q) || (c.lastMessage || "").toLowerCase().includes(q);
    });
  }, [conversations, query]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  }, [loadConversations]);

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="搜索"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
        />
        <Text style={styles.conn}>{connected ? "已连接" : "重连中…"}</Text>
      </View>
      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : undefined}
        ListEmptyComponent={
          <Text style={styles.empty}>暂无会话。去通讯录加好友或开私聊。</Text>
        }
        renderItem={({ item }) => {
          const name = conversationDisplayName(item);
          return (
            <Pressable
              style={styles.row}
              onPress={() => {
                openConversation(item.id);
                router.push(`/chat/${item.id}`);
              }}
            >
              <Avatar name={name} url={item.avatarUrl} />
              <View style={styles.meta}>
                <View style={styles.topLine}>
                  <Text style={styles.title} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text>
                </View>
                <View style={styles.bottomLine}>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMessageMine ? "我: " : ""}
                    {item.lastMessage || " "}
                  </Text>
                  {item.unreadCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {item.unreadCount > 99 ? "99+" : item.unreadCount}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
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
  conn: { fontSize: 11, color: colors.textMuted },
  error: { color: colors.danger, padding: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  meta: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  time: { fontSize: 12, color: colors.textMuted },
  bottomLine: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: spacing.sm,
  },
  preview: { flex: 1, fontSize: 13, color: colors.textSecondary },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.unread,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  emptyWrap: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  empty: { textAlign: "center", color: colors.textSecondary },
});
