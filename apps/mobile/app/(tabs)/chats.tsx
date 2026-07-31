import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "../../src/components/Avatar";
import { useChat } from "../../src/context/ChatContext";
import { api, asList } from "../../src/lib/api";
import {
  Conversation,
  conversationCompanyLabel,
  conversationDisplayName,
} from "../../src/lib/types";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../../src/theme";
import { useLocale } from "../../src/context/LocaleContext";
import { intlLocale, type ResolvedLocale } from "@qchat/i18n";

type SearchHit = {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
};

type SearchUserHit = {
  id: string;
  username: string;
  displayName: string;
};

function formatTime(iso: string | undefined, locale: ResolvedLocale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tag = intlLocale(locale);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(tag, { month: "short", day: "numeric" });
}

/** Mirror web ConversationRow last-message preview. */
function previewText(c: Conversation): string {
  if (c.lastMessageRecalled) return "Message deleted";
  if (!c.lastMessage) return "No messages yet";
  const showSender = c.lastMessageMine || c.type !== "dm";
  if (showSender && c.lastMessageSender) {
    const who = c.lastMessageMine ? "You" : c.lastMessageSender;
    return `${who}: ${c.lastMessage}`;
  }
  return c.lastMessage;
}

export default function ChatsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { resolved } = useLocale();
  const styles = useThemedStyles(makeStyles);
  const {
    conversations,
    loadConversations,
    updateConversationPrefs,
    markConversationRead,
    markUnread,
    clearHistory,
    deleteConversation,
    presenceByUser,
    connected,
    loadError,
  } = useChat();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchUsers, setSearchUsers] = useState<SearchUserHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  const selecting = selectedIds.length > 0;
  const searchActive = query.trim().length >= 2;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = conversationDisplayName(c).toLowerCase();
      const note = (c.friendNote || "").toLowerCase();
      return (
        name.includes(q) ||
        note.includes(q) ||
        (c.lastMessage || "").toLowerCase().includes(q)
      );
    });
  }, [conversations, query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchUsers([]);
      setSearchBusy(false);
      return;
    }
    let cancelled = false;
    setSearchBusy(true);
    const timer = setTimeout(() => {
      api<any>(`/v1/search?q=${encodeURIComponent(q)}`)
        .then((body) => {
          if (cancelled) return;
          setSearchHits(
            asList(body, "messages")
              .map((m: any) => ({
                id: String(m?.id ?? ""),
                conversationId: String(m?.conversation_id ?? ""),
                body: String(m?.body ?? ""),
                createdAt: String(m?.created_at ?? ""),
              }))
              .filter((h: SearchHit) => h.id && h.conversationId)
          );
          setSearchUsers(
            asList(body, "users")
              .map((u: any) => ({
                id: String(u?.id ?? ""),
                username: String(u?.username ?? ""),
                displayName: String(u?.display_name ?? u?.username ?? ""),
              }))
              .filter((u: SearchUserHit) => Boolean(u.id))
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSearchHits([]);
            setSearchUsers([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const selectedConvs = useMemo(
    () => conversations.filter((c) => selectedIds.includes(c.id)),
    [conversations, selectedIds]
  );

  const allSelectedFavorite =
    selectedConvs.length > 0 && selectedConvs.every((c) => c.favorite);
  const allSelectedMuted =
    selectedConvs.length > 0 && selectedConvs.every((c) => c.muted);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !selecting,
      headerRight:
        selecting || connected
          ? undefined
          : () => (
              <Text
                style={{
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 12,
                  fontWeight: "500",
                  marginRight: 12,
                }}
              >
                Reconnecting…
              </Text>
            ),
    });
  }, [navigation, selecting, connected]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  }, [loadConversations]);

  const applyFavorite = useCallback(async () => {
    const next = !allSelectedFavorite;
    await Promise.all(
      selectedIds.map((id) =>
        updateConversationPrefs(id, { favorite: next }).catch(() => {})
      )
    );
    clearSelection();
  }, [allSelectedFavorite, selectedIds, updateConversationPrefs, clearSelection]);

  const applyMute = useCallback(async () => {
    const next = !allSelectedMuted;
    await Promise.all(
      selectedIds.map((id) =>
        updateConversationPrefs(id, { muted: next }).catch(() => {})
      )
    );
    clearSelection();
  }, [allSelectedMuted, selectedIds, updateConversationPrefs, clearSelection]);

  const applyMarkRead = useCallback(async () => {
    await Promise.all(
      selectedIds.map((id) => markConversationRead(id).catch(() => {}))
    );
    clearSelection();
  }, [selectedIds, markConversationRead, clearSelection]);

  const applyMarkUnread = useCallback(async () => {
    await Promise.all(selectedIds.map((id) => markUnread(id).catch(() => {})));
    clearSelection();
  }, [selectedIds, markUnread, clearSelection]);

  const applyClearHistory = useCallback(() => {
    const n = selectedIds.length;
    Alert.alert(
      "Clear history",
      n === 1
        ? "Delete all messages in this conversation? The chat stays in your list."
        : `Clear message history in ${n} conversations?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await Promise.all(selectedIds.map((id) => clearHistory(id).catch(() => {})));
            clearSelection();
          },
        },
      ]
    );
  }, [selectedIds, clearHistory, clearSelection]);

  const applyDelete = useCallback(() => {
    const n = selectedIds.length;
    Alert.alert(
      "Delete conversation",
      n === 1
        ? "Remove this conversation from your list?"
        : `Remove ${n} conversations from your list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await Promise.all(
              selectedIds.map((id) => deleteConversation(id).catch(() => {}))
            );
            clearSelection();
          },
        },
      ]
    );
  }, [selectedIds, deleteConversation, clearSelection]);

  const anyUnread = selectedConvs.some((c) => c.unreadCount > 0);

  function peerIsOnline(item: Conversation): boolean {
    if (item.type !== "dm" || !item.peerId) return false;
    return Boolean(presenceByUser[item.peerId]?.online ?? item.peerOnline);
  }

  return (
    <View style={styles.root}>
      {selecting ? (
        <View style={[styles.actionBar, { paddingTop: insets.top + 10 }]}>
          <Pressable
            style={styles.actionBtn}
            onPress={clearSelection}
            hitSlop={8}
            accessibilityLabel="Cancel selection"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.actionCount}>{selectedIds.length}</Text>
          <View style={styles.actionSpacer} />
          <Pressable
            style={styles.actionBtn}
            onPress={applyFavorite}
            hitSlop={8}
            accessibilityLabel={allSelectedFavorite ? "Unfavorite" : "Favorite"}
          >
            <Ionicons
              name={allSelectedFavorite ? "star" : "star-outline"}
              size={22}
              color="#fff"
            />
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={applyMute}
            hitSlop={8}
            accessibilityLabel={allSelectedMuted ? "Unmute" : "Mute"}
          >
            <Ionicons
              name={allSelectedMuted ? "notifications-off" : "notifications-outline"}
              size={22}
              color="#fff"
            />
          </Pressable>
          {anyUnread ? (
            <Pressable
              style={styles.actionBtn}
              onPress={applyMarkRead}
              hitSlop={8}
              accessibilityLabel="Mark as read"
            >
              <Ionicons name="mail-open-outline" size={22} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              style={styles.actionBtn}
              onPress={applyMarkUnread}
              hitSlop={8}
              accessibilityLabel="Mark as unread"
            >
              <Ionicons name="mail-unread-outline" size={22} color="#fff" />
            </Pressable>
          )}
          <Pressable
            style={styles.actionBtn}
            onPress={applyClearHistory}
            hitSlop={8}
            accessibilityLabel="Clear history"
          >
            <Ionicons name="trash-bin-outline" size={22} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={applyDelete}
            hitSlop={8}
            accessibilityLabel="Delete conversation"
          >
            <Ionicons name="trash-outline" size={22} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={styles.searchWrap}>
          <View style={styles.searchField}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.search}
              placeholder={connected ? "Search" : "Reconnecting…"}
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <Pressable
            style={styles.joinBtn}
            onPress={() => router.push("/create-group")}
            accessibilityLabel="Create group"
          >
            <Ionicons name="people-outline" size={20} color={colors.accent} />
          </Pressable>
          <Pressable
            style={styles.joinBtn}
            onPress={() => router.push("/join-group")}
            accessibilityLabel="Scan QR"
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.accent} />
          </Pressable>
          <Pressable style={styles.newChat} onPress={() => router.push("/(tabs)/contacts")}>
            <Text style={styles.newChatText}>New</Text>
          </Pressable>
        </View>
      )}
      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

      {searchActive && !selecting ? (
        <View style={styles.searchResults}>
          <Text style={styles.searchSection}>
            {searchBusy
              ? "Searching people…"
              : `People (${searchUsers.length})`}
          </Text>
          {searchUsers.length === 0 && !searchBusy ? (
            <Text style={styles.searchEmpty}>No people matches</Text>
          ) : (
            searchUsers.slice(0, 12).map((u) => (
              <Pressable
                key={u.id}
                style={styles.searchHit}
                onPress={() => router.push(`/user/${u.id}`)}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.searchHitTitle} numberOfLines={1}>
                    {u.displayName || u.username || "User"}
                  </Text>
                  {u.username ? (
                    <Text style={styles.searchHitBody} numberOfLines={1}>
                      @{u.username}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            ))
          )}
          <Text style={[styles.searchSection, { marginTop: spacing.sm }]}>
            {searchBusy ? "Searching messages…" : `Messages (${searchHits.length})`}
          </Text>
          {searchHits.length === 0 && !searchBusy ? (
            <Text style={styles.searchEmpty}>No message matches</Text>
          ) : (
            searchHits.slice(0, 20).map((hit) => {
              const conv = conversations.find((c) => c.id === hit.conversationId);
              const title = conv ? conversationDisplayName(conv) : "Chat";
              return (
                <Pressable
                  key={hit.id}
                  style={styles.searchHit}
                  onPress={() => router.push(`/chat/${hit.conversationId}`)}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.searchHitTitle} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text style={styles.searchHitBody} numberOfLines={2}>
                      {hit.body || "(empty)"}
                    </Text>
                  </View>
                  <Text style={styles.searchHitTime}>{formatTime(hit.createdAt, resolved)}</Text>
                </Pressable>
              );
            })
          )}
          <Text style={[styles.searchSection, { marginTop: spacing.sm }]}>
            Conversations
          </Text>
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          selecting ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          )
        }
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyWrap : styles.listContent
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {query.trim()
              ? "No matching conversations"
              : "No conversations yet. Tap New for a DM, or the people icon to create a group."}
          </Text>
        }
        renderItem={({ item }) => {
          const name = conversationDisplayName(item);
          const muted = Boolean(item.muted);
          const mention = (item.mentionCount ?? 0) > 0;
          const selected = selectedIds.includes(item.id);
          const company = conversationCompanyLabel(item);
          const online = peerIsOnline(item);
          return (
            <Pressable
              style={[
                styles.row,
                muted && styles.rowMuted,
                selected && styles.rowSelected,
              ]}
              onPress={() => {
                if (selecting) {
                  toggleSelect(item.id);
                  return;
                }
                router.push(`/chat/${item.id}`);
              }}
              onLongPress={() => {
                if (!selectedIds.includes(item.id)) {
                  setSelectedIds((prev) => [...prev, item.id]);
                }
              }}
              delayLongPress={350}
            >
              <View style={styles.avatarWrap}>
                <Avatar name={name} url={item.avatarUrl} />
                {online && !selected ? <View style={styles.onlineDot} /> : null}
                {selected ? (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                ) : null}
              </View>
              <View style={styles.meta}>
                {company ? (
                  <Text
                    style={[
                      styles.company,
                      item.enterpriseName ? styles.companyEnterprise : null,
                    ]}
                    numberOfLines={1}
                  >
                    {company}
                  </Text>
                ) : null}
                <View style={styles.topLine}>
                  <Text style={[styles.title, muted && styles.titleMuted]} numberOfLines={1}>
                    {item.favorite ? "★ " : ""}
                    {name}
                    {muted ? " · muted" : ""}
                  </Text>
                  <Text style={styles.time}>{formatTime(item.lastMessageAt, resolved)}</Text>
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
                  {!selecting && item.unreadCount > 0 ? (
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

function makeStyles(c: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: c.bg },
  actionBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingBottom: 10,
    backgroundColor: c.headerBlue,
    minHeight: 52,
  },
  actionBtn: {
    width: 36,
    height: 40,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  actionCount: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600" as const,
    marginLeft: 4,
    minWidth: 24,
  },
  actionSpacer: { flex: 1 },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  searchField: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: c.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
  },
  search: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 15,
    color: c.text,
  },
  newChat: {
    backgroundColor: c.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  joinBtn: {
    width: 36,
    height: 36,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.sm,
    backgroundColor: c.inputBg,
  },
  newChatText: { color: "#fff", fontWeight: "700" as const, fontSize: 13 },
  searchResults: {
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    maxHeight: 220,
    paddingBottom: spacing.xs,
  },
  searchSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
    fontSize: 12,
    fontWeight: "700" as const,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  searchEmpty: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: c.textSecondary,
    fontSize: 13,
  },
  searchHit: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  searchHitTitle: { fontSize: 14, fontWeight: "600" as const, color: c.text },
  searchHitBody: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  searchHitTime: { fontSize: 11, color: c.textMuted },
  list: { flex: 1, backgroundColor: c.bg },
  listContent: { paddingBottom: spacing.sm },
  error: { color: c.danger, padding: spacing.md, backgroundColor: c.bg },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowMuted: { opacity: 0.85 },
  rowSelected: { backgroundColor: "#e8f0fe" },
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
  checkBadge: {
    position: "absolute" as const,
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.accent,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 2,
    borderColor: c.surface,
  },
  meta: { flex: 1, minWidth: 0 },
  company: {
    fontSize: 11,
    color: c.textMuted,
    marginBottom: 2,
    fontWeight: "500" as const,
  },
  companyEnterprise: { color: c.accent },
  topLine: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  title: { flex: 1, fontSize: 16, fontWeight: "600" as const, color: c.text },
  titleMuted: { color: c.textSecondary },
  time: { fontSize: 12, color: c.textMuted },
  bottomLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginTop: 4,
    gap: spacing.sm,
  },
  preview: { flex: 1, fontSize: 13, color: c.textSecondary },
  previewRecalled: { fontStyle: "italic" as const },
  previewMuted: { color: c.textMuted },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.unread,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 6,
  },
  badgeMuted: { backgroundColor: c.textMuted },
  badgeMention: { backgroundColor: c.accent },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" as const },
  emptyWrap: { flexGrow: 1, justifyContent: "center" as const, padding: spacing.xl },
  empty: { textAlign: "center" as const, color: c.textSecondary },
};
}
