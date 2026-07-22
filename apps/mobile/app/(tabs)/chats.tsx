import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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
import { Conversation, conversationDisplayName } from "../../src/lib/types";
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

/** Mirror web ConversationRow last-message preview. */
function previewText(c: Conversation): string {
  if (c.lastMessageRecalled) return "Message recalled";
  if (!c.lastMessage) return "No messages yet";
  const showSender = c.lastMessageMine || c.type !== "dm";
  if (showSender && c.lastMessageSender) {
    const who = c.lastMessageMine ? "You" : c.lastMessageSender;
    return `${who}: ${c.lastMessage}`;
  }
  return c.lastMessage;
}

export default function ChatsScreen() {
  const {
    conversations,
    loadConversations,
    openConversation,
    updateConversationPrefs,
    connected,
    loadError,
  } = useChat();
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

  const onLongPress = useCallback(
    (c: Conversation) => {
      Alert.alert(conversationDisplayName(c), undefined, [
        {
          text: c.favorite ? "Unfavorite" : "Favorite",
          onPress: () => {
            updateConversationPrefs(c.id, { favorite: !c.favorite }).catch(() => {});
          },
        },
        {
          text: c.muted ? "Unmute" : "Mute",
          onPress: () => {
            updateConversationPrefs(c.id, { muted: !c.muted }).catch(() => {});
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [updateConversationPrefs]
  );

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
        />
        <Pressable style={styles.newChat} onPress={() => router.push("/(tabs)/contacts")}>
          <Text style={styles.newChatText}>New</Text>
        </Pressable>
        <Text style={styles.conn}>{connected ? "Connected" : "Reconnecting…"}</Text>
      </View>
      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : undefined}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No conversations yet. Tap New or open Contacts to start a DM.
          </Text>
        }
        renderItem={({ item }) => {
          const name = conversationDisplayName(item);
          const muted = Boolean(item.muted);
          const mention = (item.mentionCount ?? 0) > 0;
          return (
            <Pressable
              style={[styles.row, muted && styles.rowMuted]}
              onPress={() => {
                openConversation(item.id);
                router.push(`/chat/${item.id}`);
              }}
              onLongPress={() => onLongPress(item)}
              delayLongPress={350}
            >
              <Avatar name={name} url={item.avatarUrl} />
              <View style={styles.meta}>
                <View style={styles.topLine}>
                  <Text style={[styles.title, muted && styles.titleMuted]} numberOfLines={1}>
                    {item.favorite ? "★ " : ""}
                    {name}
                    {muted ? " · muted" : ""}
                  </Text>
                  <Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text>
                </View>
                <View style={styles.bottomLine}>
                  <Text
                    style={[
                      styles.preview,
                      item.lastMessageRecalled && styles.previewRecalled,
                      muted && styles.previewMuted,
                    ]}
                    numberOfLines={1}
                  >
                    {previewText(item)}
                  </Text>
                  {item.unreadCount > 0 ? (
                    <View
                      style={[
                        styles.badge,
                        muted && styles.badgeMuted,
                        mention && styles.badgeMention,
                      ]}
                    >
                      <Text style={styles.badgeText}>
                        {mention ? "@" : ""}
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
  newChat: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  newChatText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  conn: { fontSize: 11, color: colors.textMuted, maxWidth: 72 },
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
  rowMuted: { opacity: 0.85 },
  meta: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  titleMuted: { color: colors.textSecondary },
  time: { fontSize: 12, color: colors.textMuted },
  bottomLine: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: spacing.sm,
  },
  preview: { flex: 1, fontSize: 13, color: colors.textSecondary },
  previewRecalled: { fontStyle: "italic" },
  previewMuted: { color: colors.textMuted },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.unread,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeMuted: { backgroundColor: colors.textMuted },
  badgeMention: { backgroundColor: colors.accent },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  emptyWrap: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  empty: { textAlign: "center", color: colors.textSecondary },
});
