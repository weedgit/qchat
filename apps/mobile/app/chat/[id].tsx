import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "../../src/components/Avatar";
import { ChatComposer } from "../../src/components/ChatComposer";
import { MessageActionPopup } from "../../src/components/MessageActionPopup";
import { useChat } from "../../src/context/ChatContext";
import { useCallApi } from "../../src/context/CallContext";
import { Conversation, Message, Reaction, conversationDisplayName } from "../../src/lib/types";
import {
  nextPinnedFromScroll,
  previousPinnedInCycle,
  type PinnedMessage,
} from "../../src/lib/pinnedCycle";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../../src/theme";

function messageBody(item: Message): string {
  if (item.type === "image") return item.content || "Photo";
  if (item.type === "file") return item.content || "File";
  if (item.type === "voice") return item.content || "Voice message";
  if (item.mediaUrl && !item.content) {
    if (item.type === "image") return "Photo";
    if (item.type === "voice") return "Voice message";
    return "File";
  }
  return item.content || "";
}

function canRecall(m: Message, canAdminRecall: boolean): boolean {
  return Boolean(
    !m.recalled && !m.pending && !m.failed && (m.mine || canAdminRecall)
  );
}

function canForward(m: Message): boolean {
  return Boolean(!m.recalled && !m.pending && !m.failed);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Ionicons receipts — Unicode ✓ ignores color on Android and looks blue-on-blue. */
function ReceiptIcons({ msg }: { msg: Message }) {
  if (!msg.mine || msg.recalled) return null;
  if (msg.pending) {
    return <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.75)" />;
  }
  if (msg.failed) {
    return <Ionicons name="alert-circle" size={12} color="#fecaca" />;
  }
  const tint = msg.read ? "#fff" : "rgba(255,255,255,0.7)";
  return (
    <Ionicons
      name={msg.read ? "checkmark-done" : "checkmark"}
      size={14}
      color={tint}
    />
  );
}

function MediaBody({ item, mine }: { item: Message; mine: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const icon =
    item.type === "image" ? "image-outline" : item.type === "voice" ? "mic-outline" : "document-outline";
  const label =
    item.type === "image" ? "Photo" : item.type === "voice" ? "Voice message" : "File";
  const detail =
    item.content &&
    item.content !== "Photo" &&
    item.content !== "File" &&
    item.content !== "Voice message"
      ? item.content
      : null;
  const tint = mine ? "#fff" : colors.text;
  const subTint = mine ? "rgba(255,255,255,0.8)" : colors.textMuted;

  return (
    <View style={styles.mediaRow}>
      <View style={[styles.mediaIconWrap, mine ? styles.mediaIconMine : styles.mediaIconPeer]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={styles.mediaTextCol}>
        <Text style={[styles.mediaTitle, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.mediaDetail, { color: subTint }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type ReplyPreview = { name: string; body: string };

type ChatMessageRowProps = {
  item: Message;
  selected: boolean;
  pinned: boolean;
  highlighted: boolean;
  /** Show sender name above peer bubbles (groups only — DMs omit it). */
  showSender: boolean;
  replyPreview?: ReplyPreview | null;
  onPress: (item: Message) => void;
  onLongPress: (item: Message) => void;
  onPressReply?: (replyToId: string) => void;
};

/** Memoized row — keeps FlatList from re-rendering every bubble on parent updates. */
const ChatMessageRow = memo(function ChatMessageRow({
  item,
  selected,
  pinned,
  highlighted,
  showSender,
  replyPreview,
  onPress,
  onLongPress,
  onPressReply,
}: ChatMessageRowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (item.recalled) {
    const label = item.mine
      ? "You recalled a message"
      : showSender && item.senderName
        ? `${item.senderName} recalled a message`
        : "Message recalled";
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{label}</Text>
      </View>
    );
  }

  const mine = Boolean(item.mine);
  const isMedia =
    item.type === "image" ||
    item.type === "file" ||
    item.type === "voice" ||
    Boolean(item.mediaUrl);
  const time = fmtTime(item.createdAt);

  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      style={[
        styles.bubbleWrap,
        mine ? styles.mineWrap : styles.peerWrap,
        selected && styles.bubbleWrapSelected,
      ]}
    >
      <View
        style={[
          styles.bubble,
          mine ? styles.mine : styles.peer,
          selected && (mine ? styles.mineSelected : styles.peerSelected),
          highlighted && styles.bubbleHighlighted,
        ]}
      >
        {selected ? (
          <View style={[styles.checkBadge, mine ? styles.checkMine : styles.checkPeer]}>
            <Ionicons name="checkmark" size={12} color="#fff" />
          </View>
        ) : null}
        {showSender && !mine && item.senderName ? (
          <Text style={styles.sender}>{item.senderName}</Text>
        ) : null}
        {replyPreview && item.replyToId ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onPressReply?.(item.replyToId!);
            }}
            style={[styles.replyQuote, mine ? styles.replyQuoteMine : styles.replyQuotePeer]}
          >
            <View style={[styles.replyBar, mine ? styles.replyBarMine : styles.replyBarPeer]} />
            <View style={styles.replyQuoteBody}>
              <Text
                style={[styles.replyName, mine ? styles.replyNameMine : styles.replyNamePeer]}
                numberOfLines={1}
              >
                {replyPreview.name}
              </Text>
              <Text
                style={[styles.replySnippet, mine ? styles.replySnippetMine : styles.replySnippetPeer]}
                numberOfLines={2}
              >
                {replyPreview.body}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {isMedia ? (
          <MediaBody item={item} mine={mine} />
        ) : (
          <Text style={[styles.body, mine ? styles.mineText : styles.peerText]}>
            {messageBody(item)}
          </Text>
        )}
        {item.failed ? (
          <Text style={mine ? styles.fail : styles.failPeer}>Failed to send</Text>
        ) : null}
        {(item.reactions?.length ?? 0) > 0 ? (
          <View style={styles.reactionRow}>
            {item.reactions!.map((r: Reaction) => (
              <View
                key={r.emoji}
                style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
              >
                <Text style={styles.reactionChipText}>
                  {r.emoji} {r.count > 1 ? r.count : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.metaRow}>
          {pinned && !item.recalled ? (
            <Ionicons
              name="pin"
              size={11}
              color={mine ? "rgba(255,255,255,0.9)" : colors.accent}
            />
          ) : null}
          {time ? (
            <Text style={[styles.metaTime, mine ? styles.metaTimeMine : styles.metaTimePeer]}>
              {time}
            </Text>
          ) : null}
          {mine ? <ReceiptIcons msg={item} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

function replyPreviewFor(
  msg: Message,
  byId: Map<string, Message>
): ReplyPreview | null {
  if (!msg.replyToId) return null;
  const target = byId.get(msg.replyToId);
  if (!target) return { name: "Reply", body: "Original message" };
  return {
    name: target.mine ? "You" : target.senderName || "User",
    body: messageBody(target) || "Message",
  };
}

type ChatMessageListProps = {
  list: Message[];
  selectedSet: Set<string>;
  pinnedIdSet: Set<string>;
  highlightedId?: string | null;
  showSender: boolean;
  listRef: RefObject<FlatList<Message> | null>;
  onScroll: (e: any) => void;
  onViewableItemsChanged: (info: {
    viewableItems: Array<{ index: number | null }>;
  }) => void;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
  onPressMessage: (item: Message) => void;
  onLongPressMessage: (item: Message) => void;
  onPressReply?: (replyToId: string) => void;
};

const ChatMessageList = memo(function ChatMessageList({
  list,
  selectedSet,
  pinnedIdSet,
  highlightedId,
  showSender,
  listRef,
  onScroll,
  onViewableItemsChanged,
  viewabilityConfig,
  onPressMessage,
  onLongPressMessage,
  onPressReply,
}: ChatMessageListProps) {
  const styles = useThemedStyles(makeStyles);
  const keyExtractor = useCallback((m: Message) => m.id, []);
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list]);
  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <ChatMessageRow
        item={item}
        selected={selectedSet.has(item.id)}
        pinned={pinnedIdSet.has(item.id)}
        highlighted={highlightedId === item.id}
        showSender={showSender}
        replyPreview={replyPreviewFor(item, byId)}
        onPress={onPressMessage}
        onLongPress={onLongPressMessage}
        onPressReply={onPressReply}
      />
    ),
    [
      selectedSet,
      pinnedIdSet,
      highlightedId,
      showSender,
      byId,
      onPressMessage,
      onLongPressMessage,
      onPressReply,
    ]
  );

  return (
    <FlatList
      ref={listRef}
      data={list}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      extraData={`${selectedSet.size}:${highlightedId ?? ""}`}
      contentContainerStyle={styles.list}
      onScroll={onScroll}
      scrollEventThrottle={32}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      // Keep more of the list mounted so scroll-to-end can reach the real bottom
      // (variable-height bubbles + clipped views make one-shot scrollToEnd stop short).
      removeClippedSubviews={false}
      windowSize={21}
      maxToRenderPerBatch={16}
      updateCellsBatchingPeriod={40}
      initialNumToRender={20}
      onScrollToIndexFailed={(info) => {
        const offset = Math.max(0, info.averageItemLength * info.index);
        listRef.current?.scrollToOffset({ offset, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({
            index: info.index,
            animated: true,
            viewPosition: info.index >= list.length - 1 ? 1 : 0.35,
          });
        }, 100);
      }}
      ListEmptyComponent={
        <Text style={styles.emptyThread}>No messages here yet…</Text>
      }
    />
  );
});

/** Mirror web ForwardPicker / Mattermost ForwardPostModal. */
function ForwardPicker({
  conversations,
  messageCount,
  onCancel,
  onSend,
}: {
  conversations: Conversation[];
  messageCount: number;
  onCancel: () => void;
  onSend: (conversationIds: string[]) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      conversationDisplayName(c).toLowerCase().includes(q)
    );
  }, [conversations, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      await onSend(Array.from(selected));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not forward");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.forwardBg}>
        <View style={styles.forwardCard}>
          <Text style={styles.forwardTitle}>
            Forward {messageCount > 1 ? `${messageCount} messages` : "message"} to…
          </Text>
          <TextInput
            style={styles.forwardSearch}
            placeholder="Search conversations"
            placeholderTextColor={colors.textMuted}
            value={filter}
            onChangeText={setFilter}
          />
          <ScrollView style={styles.forwardList} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text style={styles.forwardEmpty}>No conversations</Text>
            ) : (
              filtered.map((c) => {
                const name = conversationDisplayName(c);
                const checked = selected.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={styles.forwardRow}
                    onPress={() => toggle(c.id)}
                  >
                    <Ionicons
                      name={checked ? "checkbox" : "square-outline"}
                      size={22}
                      color={checked ? colors.accent : colors.textMuted}
                    />
                    <Avatar name={name} url={c.avatarUrl} size={36} />
                    <View style={styles.forwardRowText}>
                      <Text style={styles.forwardName} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={styles.forwardType}>
                        {c.type === "dm" ? "Direct message" : "Group"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <View style={styles.forwardActions}>
            <Pressable style={styles.forwardCancel} onPress={onCancel} disabled={busy}>
              <Text style={styles.forwardCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.forwardSend,
                (selected.size === 0 || busy) && styles.forwardSendDisabled,
              ]}
              onPress={submit}
              disabled={selected.size === 0 || busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.forwardSendText}>
                  Forward{selected.size > 0 ? ` (${selected.size})` : ""}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = String(id);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {
    conversations,
    messages,
    openConversation,
    sendMessage,
    recallMessage,
    forwardMessage,
    reactMessage,
    pinMessage,
    editMessage,
    sendMediaMessage,
    sendVoiceMessage,
  } = useChat();
  const call = useCallApi();
  const [text, setText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ctxMsg, setCtxMsg] = useState<Message | null>(null);
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [barPin, setBarPin] = useState<PinnedMessage | null>(null);
  const [pinsListOpen, setPinsListOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const nearBottomRef = useRef(true);
  /** Cancels in-flight jump-to-bottom settle retries when a newer jump starts. */
  const jumpBottomGenRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selecting = selectedIds.length > 0;

  const conversation = useMemo(
    () => conversations.find((c) => c.id === convId) ?? null,
    [conversations, convId]
  );
  const isGroup =
    conversation?.type === "social_group" || conversation?.type === "group";
  const canAdminRecall =
    isGroup && (conversation?.role === "owner" || conversation?.role === "admin");
  const list = messages[convId] ?? [];

  const selectedMsgs = useMemo(
    () => list.filter((m) => selectedIds.includes(m.id)),
    [list, selectedIds]
  );

  const canCopySelected = selectedMsgs.some(
    (m) => !m.recalled && Boolean(messageBody(m).trim())
  );
  const canRecallSelected =
    selectedMsgs.length > 0 &&
    selectedMsgs.every((m) => canRecall(m, canAdminRecall));
  const forwardableSelected = selectedMsgs.filter((m) => canForward(m));
  const pinnedList: PinnedMessage[] = useMemo(() => {
    if (!conversation) return [];
    if (conversation.pinnedMessages?.length) return conversation.pinnedMessages;
    if (conversation.pinnedMessageId) {
      return [
        {
          id: conversation.pinnedMessageId,
          body: conversation.pinnedMessage || "Pinned message",
        },
      ];
    }
    return [];
  }, [conversation]);
  const pinnedIdSet = useMemo(() => new Set(pinnedList.map((p) => p.id)), [pinnedList]);

  const syncBarFromIndices = useCallback(
    (minVisibleIndex: number) => {
      if (pinnedList.length === 0) {
        setBarPin((prev) => (prev ? null : prev));
        return;
      }
      const tops: Record<string, number> = {};
      for (const p of pinnedList) {
        const idx = list.findIndex((m) => m.id === p.id);
        if (idx >= 0) tops[p.id] = idx * 1000;
      }
      const focusY = Math.max(0, minVisibleIndex) * 1000 + 100;
      const next = nextPinnedFromScroll(pinnedList, focusY, tops);
      setBarPin((prev) => (prev?.id === next?.id ? prev : next));
    },
    [pinnedList, list]
  );
  const syncBarFromIndicesRef = useRef(syncBarFromIndices);
  syncBarFromIndicesRef.current = syncBarFromIndices;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      const idxs = viewableItems
        .map((v) => v.index)
        .filter((n): n is number => typeof n === "number");
      if (idxs.length === 0) return;
      syncBarFromIndicesRef.current(Math.min(...idxs));
    }
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  useEffect(() => {
    if (pinnedList.length === 0) {
      setBarPin(null);
      return;
    }
    setBarPin((prev) => {
      if (prev && pinnedList.some((p) => p.id === prev.id)) return prev;
      return pinnedList[pinnedList.length - 1];
    });
  }, [convId, pinnedList.map((p) => p.id).join(",")]);

  const jumpToMessageId = useCallback(
    (id: string, opts?: { syncBar?: boolean; missingTitle?: string }) => {
      const index = list.findIndex((m) => m.id === id);
      if (index < 0) {
        Alert.alert(
          opts?.missingTitle ?? "Message",
          "Message is not loaded in this view yet."
        );
        return;
      }
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedId(id);
      highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1600);
      if (opts?.syncBar !== false) {
        setTimeout(() => syncBarFromIndices(index), 350);
      }
    },
    [list, syncBarFromIndices]
  );

  const jumpToPinnedId = useCallback(
    (id: string, opts?: { syncBar?: boolean }) => {
      jumpToMessageId(id, { ...opts, missingTitle: "Pinned message" });
    },
    [jumpToMessageId]
  );

  const onPressReply = useCallback(
    (replyToId: string) => {
      jumpToMessageId(replyToId, { missingTitle: "Reply" });
    },
    [jumpToMessageId]
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const jumpToPinned = useCallback(() => {
    const target = barPin ?? pinnedList[pinnedList.length - 1];
    if (!target) return;
    // Don't re-sync from scroll mid-animation — bar already advances to previous.
    jumpToPinnedId(target.id, { syncBar: false });
    const prev = previousPinnedInCycle(pinnedList, target.id);
    if (prev) setBarPin(prev);
  }, [barPin, pinnedList, jumpToPinnedId]);

  useEffect(() => {
    openConversation(convId);
    nearBottomRef.current = true;
    setShowJumpBottom(false);
  }, [convId, openConversation]);

  useLayoutEffect(() => {
    if (pinsListOpen) {
      navigation.setOptions({
        headerShown: true,
        title: "Pinned messages",
        headerTitleAlign: "left",
        headerLeft: () => (
          <Pressable
            onPress={() => setPinsListOpen(false)}
            hitSlop={8}
            style={{ marginLeft: Platform.OS === "ios" ? 0 : 8, padding: 4 }}
            accessibilityLabel="Back"
          >
            <Ionicons
              name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
              size={28}
              color="#fff"
            />
          </Pressable>
        ),
        headerRight: () => null,
      });
      return;
    }
    const isDm = conversation?.type === "dm";
    const callBusy = Boolean(call.active || call.incoming);
    const title = conversation ? conversationDisplayName(conversation) : "Chat";
    const openChatInfo = () => {
      if (!conversation) return;
      router.push({ pathname: "/chat-info/[id]", params: { id: conversation.id } });
    };
    const openTitleTarget = () => {
      if (!conversation) return;
      // DM title → peer profile; group title → group details (chat-info).
      // Do not treat peerId alone as DM — groups also return a peer_id (first other member).
      if (isDm && conversation.peerId) {
        router.push({ pathname: "/user/[id]", params: { id: conversation.peerId } });
        return;
      }
      openChatInfo();
    };
    navigation.setOptions({
      headerShown: !selecting,
      title,
      headerTitleAlign: "left",
      headerTitle: () => (
        <Pressable onPress={openTitleTarget} hitSlop={6} style={{ maxWidth: 180 }}>
          <Text
            numberOfLines={1}
            style={{
              color: "#fff",
              fontSize: 17,
              fontWeight: "600",
            }}
          >
            {title}
          </Text>
        </Pressable>
      ),
      headerLeft: undefined,
      headerRight: () => (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginRight: Platform.OS === "ios" ? 8 : 4,
          }}
        >
          {isDm ? (
            <>
              <Pressable
                onPress={() => {
                  if (callBusy || !conversation) return;
                  call
                    .startCall(conversation.id, "voice", conversationDisplayName(conversation))
                    .catch((e) => Alert.alert("Call failed", e?.message || "Could not start call"));
                }}
                disabled={callBusy}
                hitSlop={10}
                style={{ paddingHorizontal: 8, paddingVertical: 6, opacity: callBusy ? 0.4 : 1 }}
                accessibilityLabel="Voice call"
              >
                <Ionicons name="call-outline" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => {
                  if (callBusy || !conversation) return;
                  call
                    .startCall(conversation.id, "video", conversationDisplayName(conversation))
                    .catch((e) => Alert.alert("Call failed", e?.message || "Could not start call"));
                }}
                disabled={callBusy}
                hitSlop={10}
                style={{ paddingHorizontal: 8, paddingVertical: 6, opacity: callBusy ? 0.4 : 1 }}
                accessibilityLabel="Video call"
              >
                <Ionicons name="videocam-outline" size={24} color="#fff" />
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={openChatInfo}
            hitSlop={10}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
            accessibilityLabel="Chat info"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
          </Pressable>
        </View>
      ),
    });
  }, [
    navigation,
    conversation,
    selecting,
    pinsListOpen,
    call.active,
    call.incoming,
    call.startCall,
  ]);

  useEffect(() => {
    if (pinsListOpen && pinnedList.length === 0) {
      setPinsListOpen(false);
    }
  }, [pinsListOpen, pinnedList.length]);

  const pinnedThreadMessages = useMemo(() => {
    const byId = new Map(list.map((m) => [m.id, m]));
    // Same chronological order as chat history (seq ascending = top→bottom).
    return pinnedList.map((p) => {
      const loaded = byId.get(p.id);
      if (loaded) return loaded;
      return {
        id: p.id,
        conversationId: convId,
        senderId: "",
        content: p.body || "Pinned message",
        type: p.type || "text",
        createdAt: "",
        mine: false,
      } as Message;
    });
  }, [pinnedList, list, convId]);

  const emptySelectedSet = useMemo(() => new Set<string>(), []);
  const noopScroll = useCallback(() => {}, []);
  const noopViewable = useRef(
    (_info: { viewableItems: Array<{ index: number | null }> }) => {}
  ).current;

  /** Scroll until FlatList has measured the real end (lazy rows grow contentSize). */
  const scrollToTrueBottom = useCallback(
    (animated: boolean) => {
      const lastIndex = list.length - 1;
      if (lastIndex < 0) return;
      const gen = ++jumpBottomGenRef.current;
      const step = (useAnim: boolean, delayMs: number) => {
        setTimeout(() => {
          if (gen !== jumpBottomGenRef.current) return;
          listRef.current?.scrollToIndex({
            index: lastIndex,
            animated: useAnim,
            viewPosition: 1,
          });
          // Second pass: contentSize often grows after bottom cells mount.
          listRef.current?.scrollToEnd({ animated: false });
        }, delayMs);
      };
      step(animated, 0);
      step(false, 80);
      step(false, 200);
      step(false, 420);
      step(false, 700);
    },
    [list.length]
  );

  useEffect(() => {
    if (list.length === 0) return;
    if (!nearBottomRef.current) return;
    scrollToTrueBottom(true);
  }, [list.length, scrollToTrueBottom]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const onListScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    const near = distanceFromBottom < 80;
    nearBottomRef.current = near;
    const show = !near && contentSize.height > layoutMeasurement.height + 40;
    setShowJumpBottom((prev) => (prev === show ? prev : show));
  }, []);

  const jumpToBottom = useCallback(() => {
    nearBottomRef.current = true;
    setShowJumpBottom(false);
    scrollToTrueBottom(true);
  }, [scrollToTrueBottom]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const onPressMessage = useCallback(
    (item: Message) => {
      if (selectedIds.length > 0) {
        toggleSelect(item.id);
        return;
      }
      setCtxMsg(item);
    },
    [selectedIds.length, toggleSelect]
  );

  const onLongPressMessage = useCallback((item: Message) => {
    setPinsListOpen(false);
    setSelectedIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
  }, []);

  async function onSend() {
    const body = text.trim();
    if (!body) return;
    setText("");
    if (editing) {
      const target = editing;
      setEditing(null);
      setReplyTo(null);
      try {
        await editMessage(target.id, convId, body);
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Could not edit message");
        setText(body);
        setEditing(target);
      }
      return;
    }
    const replyId = replyTo?.id;
    setReplyTo(null);
    await sendMessage(convId, body, replyId);
  }

  async function shareText(parts: string[]) {
    const msg = parts.filter(Boolean).join("\n");
    if (!msg) return;
    await Share.share({ message: msg });
  }

  async function onShareSelected() {
    const parts = selectedMsgs
      .filter((m) => !m.recalled)
      .map((m) => messageBody(m).trim())
      .filter(Boolean);
    await shareText(parts);
    clearSelection();
  }

  async function onRecallSelected() {
    if (!canRecallSelected) return;
    try {
      for (const m of selectedMsgs) {
        await recallMessage(m.id, convId);
      }
      clearSelection();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not recall message");
    }
  }

  function onForwardSelected() {
    if (forwardableSelected.length === 0) return;
    setForwardIds(forwardableSelected.map((m) => m.id));
  }

  async function onPopupAction(action: string) {
    if (!ctxMsg) return;
    const msg = ctxMsg;
    setCtxMsg(null);
    switch (action) {
      case "reply":
        setPinsListOpen(false);
        setEditing(null);
        setReplyTo(msg);
        break;
      case "copy":
        await shareText([messageBody(msg).trim()]);
        break;
      case "forward":
        setForwardIds([msg.id]);
        break;
      case "pin":
        try {
          await pinMessage(msg.id, convId, true);
        } catch (e: any) {
          Alert.alert("Error", e?.message || "Could not pin");
        }
        break;
      case "unpin":
        try {
          await pinMessage(msg.id, convId, false);
        } catch (e: any) {
          Alert.alert("Error", e?.message || "Could not unpin");
        }
        break;
      case "edit":
        setPinsListOpen(false);
        setReplyTo(null);
        setEditing(msg);
        setText(messageBody(msg));
        break;
      case "delete":
        try {
          await recallMessage(msg.id, convId);
        } catch (e: any) {
          Alert.alert("Error", e?.message || "Could not delete message");
        }
        break;
      case "select":
        setPinsListOpen(false);
        setSelectedIds((prev) => (prev.includes(msg.id) ? prev : [...prev, msg.id]));
        break;
    }
  }

  async function onPopupReact(emoji: string) {
    if (!ctxMsg) return;
    const msg = ctxMsg;
    setCtxMsg(null);
    try {
      await reactMessage(msg.id, convId, emoji);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not react");
    }
  }

  if (pinsListOpen) {
    return (
      <View style={styles.root}>
        <ChatMessageList
          list={pinnedThreadMessages}
          selectedSet={emptySelectedSet}
          pinnedIdSet={pinnedIdSet}
          highlightedId={highlightedId}
          showSender={isGroup}
          listRef={listRef}
          onScroll={noopScroll}
          onViewableItemsChanged={noopViewable}
          viewabilityConfig={viewabilityConfig}
          onPressMessage={onPressMessage}
          onLongPressMessage={onLongPressMessage}
          onPressReply={onPressReply}
        />
        <Modal
          visible={Boolean(ctxMsg)}
          transparent
          animationType="fade"
          onRequestClose={() => setCtxMsg(null)}
        >
          {ctxMsg ? (
            <MessageActionPopup
              msg={ctxMsg}
              pinned={pinnedIdSet.has(ctxMsg.id)}
              canAdminRecall={canAdminRecall}
              onClose={() => setCtxMsg(null)}
              onReact={onPopupReact}
              onAction={onPopupAction}
            />
          ) : null}
        </Modal>
        {forwardIds && forwardIds.length > 0 ? (
          <ForwardPicker
            conversations={conversations}
            messageCount={forwardIds.length}
            onCancel={() => setForwardIds(null)}
            onSend={async (targetIds) => {
              for (const mid of forwardIds) {
                await forwardMessage(mid, targetIds);
              }
              setForwardIds(null);
              clearSelection();
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
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
          {canCopySelected ? (
            <Pressable
              style={styles.actionBtn}
              onPress={onShareSelected}
              hitSlop={8}
              accessibilityLabel="Share"
            >
              <Ionicons name="share-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
          {forwardableSelected.length > 0 ? (
            <Pressable
              style={styles.actionBtn}
              onPress={onForwardSelected}
              hitSlop={8}
              accessibilityLabel="Forward"
            >
              <Ionicons name="arrow-redo-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
          {canRecallSelected ? (
            <Pressable
              style={styles.actionBtn}
              onPress={onRecallSelected}
              hitSlop={8}
              accessibilityLabel="Recall"
            >
              <Ionicons name="arrow-undo-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {pinnedList.length > 0 && !selecting ? (
        <View style={styles.pinnedBanner}>
          <View style={styles.pinnedAccent} />
          <Pressable style={styles.pinnedMain} onPress={jumpToPinned}>
            <Text style={styles.pinnedLabel}>
              Pinned Message{pinnedList.length > 1 ? ` · ${pinnedList.length}` : ""}
            </Text>
            <Text style={styles.pinnedText} numberOfLines={1}>
              {(barPin ?? pinnedList[pinnedList.length - 1])?.body || "Pinned message"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.pinnedListBtn}
            onPress={() => setPinsListOpen(true)}
            accessibilityLabel="Pinned messages"
            hitSlop={6}
          >
            <Ionicons name="list" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.threadWrap}>
        <ChatMessageList
          list={list}
          selectedSet={selectedSet}
          pinnedIdSet={pinnedIdSet}
          highlightedId={highlightedId}
          showSender={isGroup}
          listRef={listRef}
          onScroll={onListScroll}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onPressMessage={onPressMessage}
          onLongPressMessage={onLongPressMessage}
          onPressReply={onPressReply}
        />
        {showJumpBottom ? (
          <Pressable
            style={styles.jumpBottom}
            onPress={jumpToBottom}
            accessibilityLabel="Scroll to bottom"
          >
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Pressable>
        ) : null}
      </View>

      {!selecting ? (
        <ChatComposer
          text={text}
          onChangeText={setText}
          onSend={onSend}
          editing={editing}
          replyTo={replyTo}
          onCancelEdit={() => {
            setEditing(null);
            setText("");
          }}
          onCancelReply={() => setReplyTo(null)}
          onPickMedia={(uri, kind, name, mimeType) => {
            sendMediaMessage(convId, uri, {
              kind,
              name,
              mimeType,
              replyToId: replyTo?.id,
            }).catch(() => {});
            setReplyTo(null);
          }}
          onSendVoice={(uri, durationSec) => {
            sendVoiceMessage(convId, uri, durationSec, replyTo?.id).catch(() => {});
            setReplyTo(null);
          }}
        />
      ) : null}

      <Modal
        visible={Boolean(ctxMsg)}
        transparent
        animationType="fade"
        onRequestClose={() => setCtxMsg(null)}
      >
        {ctxMsg ? (
          <MessageActionPopup
            msg={ctxMsg}
            pinned={conversation?.pinnedMessages?.some((p) => p.id === ctxMsg.id) ||
              conversation?.pinnedMessageId === ctxMsg.id}
            canAdminRecall={canAdminRecall}
            onClose={() => setCtxMsg(null)}
            onReact={onPopupReact}
            onAction={onPopupAction}
          />
        ) : null}
      </Modal>

      {forwardIds && forwardIds.length > 0 ? (
        <ForwardPicker
          conversations={conversations}
          messageCount={forwardIds.length}
          onCancel={() => setForwardIds(null)}
          onSend={async (targetIds) => {
            for (const mid of forwardIds) {
              await forwardMessage(mid, targetIds);
            }
            setForwardIds(null);
            clearSelection();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: c.bg },
  actionBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingBottom: 10,
    backgroundColor: c.headerBlue,
    minHeight: 52,
  },
  actionBtn: {
    width: 40,
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
  pinnedBanner: {
    flexDirection: "row" as const,
    alignItems: "stretch" as const,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    minHeight: 52,
  },
  pinnedAccent: {
    width: 3,
    backgroundColor: c.accent,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  pinnedMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pinnedLabel: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: c.accent,
    marginBottom: 2,
  },
  pinnedText: {
    fontSize: 13,
    color: c.textSecondary,
  },
  pinnedListBtn: {
    width: 44,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: c.border,
  },
  threadWrap: { flex: 1, position: "relative" as const },
  list: { padding: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
  jumpBottom: {
    position: "absolute" as const,
    right: 16,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(36, 40, 48, 0.88)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  emptyThread: {
    textAlign: "center" as const,
    color: c.textMuted,
    marginTop: spacing.xxl,
    fontSize: 14,
  },
  systemRow: {
    alignItems: "center" as const,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  systemText: {
    fontSize: 12,
    color: c.textMuted,
    textAlign: "center" as const,
  },
  bubbleWrap: { marginBottom: spacing.sm, flexDirection: "row" as const },
  bubbleWrapSelected: { opacity: 1 },
  mineWrap: { justifyContent: "flex-end" as const },
  peerWrap: { justifyContent: "flex-start" as const },
  bubble: {
    maxWidth: "78%" as const,
    minWidth: 72,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    position: "relative" as const,
  },
  mine: {
    backgroundColor: c.bubbleMine,
    borderBottomRightRadius: 4,
  },
  peer: {
    backgroundColor: c.bubblePeer,
    borderWidth: 1,
    borderColor: c.border,
    borderBottomLeftRadius: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.08,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  mineSelected: { backgroundColor: "#1a4fb8" },
  peerSelected: { backgroundColor: "#e8f0fe", borderColor: c.accent },
  bubbleHighlighted: {
    borderWidth: 2,
    borderColor: c.accent,
  },
  checkBadge: {
    position: "absolute" as const,
    top: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: c.accent,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 2,
    borderColor: c.bg,
    zIndex: 1,
  },
  checkMine: { left: -6 },
  checkPeer: { right: -6 },
  sender: { fontSize: 12, fontWeight: "600" as const, color: c.accent, marginBottom: 2 },
  replyQuote: {
    flexDirection: "row" as const,
    borderRadius: 8,
    marginBottom: 6,
    overflow: "hidden" as const,
    alignSelf: "stretch" as const,
  },
  replyQuoteMine: { backgroundColor: "rgba(255,255,255,0.18)" },
  replyQuotePeer: { backgroundColor: "rgba(36,99,220,0.08)" },
  replyBar: { width: 3 },
  replyBarMine: { backgroundColor: "#fff" },
  replyBarPeer: { backgroundColor: c.accent },
  replyQuoteBody: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, minWidth: 0 },
  replyName: { fontSize: 13, fontWeight: "700" as const, marginBottom: 2 },
  replyNameMine: { color: "#fff" },
  replyNamePeer: { color: c.accent },
  replySnippet: { fontSize: 13, lineHeight: 17 },
  replySnippetMine: { color: "rgba(255,255,255,0.9)" },
  replySnippetPeer: { color: c.textSecondary },
  body: { fontSize: 16, lineHeight: 22 },
  mineText: { color: "#fff" },
  peerText: { color: c.text },
  mediaRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minWidth: 140 },
  mediaIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  mediaIconMine: { backgroundColor: "rgba(255,255,255,0.18)" },
  mediaIconPeer: { backgroundColor: "rgba(36,99,220,0.1)" },
  mediaTextCol: { flex: 1, minWidth: 0 },
  mediaTitle: { fontSize: 15, fontWeight: "600" as const },
  mediaDetail: { fontSize: 12, marginTop: 2 },
  fail: { fontSize: 11, color: "#fecaca", marginTop: 4 },
  failPeer: { fontSize: 11, color: c.danger, marginTop: 4 },
  reactionRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 4,
    marginTop: 6,
  },
  reactionChip: {
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reactionChipMine: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  reactionChipText: { fontSize: 13 },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 4,
    marginTop: 4,
    alignSelf: "flex-end" as const,
  },
  metaTime: { fontSize: 11, fontWeight: "500" as const },
  metaTimeMine: { color: "rgba(255,255,255,0.88)" },
  metaTimePeer: { color: "#4b5563" },
  forwardBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end" as const,
  },
  forwardCard: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "85%" as const,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  forwardTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: c.text,
    marginBottom: spacing.sm,
  },
  forwardSearch: {
    backgroundColor: c.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: c.text,
    marginBottom: spacing.sm,
  },
  forwardList: { maxHeight: 360 },
  forwardEmpty: {
    textAlign: "center" as const,
    color: c.textMuted,
    paddingVertical: spacing.lg,
  },
  forwardRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  forwardRowText: { flex: 1, minWidth: 0 },
  forwardName: { fontSize: 15, fontWeight: "600" as const, color: c.text },
  forwardType: { fontSize: 12, color: c.textMuted, marginTop: 1 },
  forwardActions: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  forwardCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  forwardCancelText: { fontSize: 15, color: c.textSecondary, fontWeight: "600" as const },
  forwardSend: {
    backgroundColor: c.accent,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center" as const,
  },
  forwardSendDisabled: { opacity: 0.45 },
  forwardSendText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
};
}
