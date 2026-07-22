import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "../../src/components/Avatar";
import { useChat } from "../../src/context/ChatContext";
import { Conversation, Message, conversationDisplayName } from "../../src/lib/types";
import { colors, radius, spacing } from "../../src/theme";

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

function canRecall(m: Message): boolean {
  return Boolean(m.mine && !m.recalled && !m.pending && !m.failed);
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
  const {
    conversations,
    messages,
    openConversation,
    sendMessage,
    recallMessage,
    forwardMessage,
  } = useChat();
  const [text, setText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ctxMsg, setCtxMsg] = useState<Message | null>(null);
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const listRef = useRef<FlatList>(null);
  const nearBottomRef = useRef(true);

  const selecting = selectedIds.length > 0;

  const conversation = useMemo(
    () => conversations.find((c) => c.id === convId) ?? null,
    [conversations, convId]
  );
  const list = messages[convId] ?? [];

  const selectedMsgs = useMemo(
    () => list.filter((m) => selectedIds.includes(m.id)),
    [list, selectedIds]
  );

  const canCopySelected = selectedMsgs.some(
    (m) => !m.recalled && Boolean(messageBody(m).trim())
  );
  const canRecallSelected =
    selectedMsgs.length > 0 && selectedMsgs.every((m) => canRecall(m));
  const forwardableSelected = selectedMsgs.filter((m) => canForward(m));

  useEffect(() => {
    openConversation(convId);
    nearBottomRef.current = true;
    setShowJumpBottom(false);
  }, [convId, openConversation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !selecting,
      title: conversation ? conversationDisplayName(conversation) : "Chat",
    });
  }, [navigation, conversation, selecting]);

  useEffect(() => {
    if (list.length === 0) return;
    if (!nearBottomRef.current) return;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [list.length]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const onListScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    const near = distanceFromBottom < 80;
    nearBottomRef.current = near;
    setShowJumpBottom(!near && contentSize.height > layoutMeasurement.height + 40);
  }, []);

  const jumpToBottom = useCallback(() => {
    nearBottomRef.current = true;
    setShowJumpBottom(false);
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  async function onSend() {
    const body = text.trim();
    if (!body) return;
    setText("");
    await sendMessage(convId, body);
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

  async function onCtxShare() {
    if (!ctxMsg || ctxMsg.recalled) return;
    const body = messageBody(ctxMsg).trim();
    setCtxMsg(null);
    await shareText([body]);
  }

  function onCtxForward() {
    if (!ctxMsg || !canForward(ctxMsg)) return;
    const mid = ctxMsg.id;
    setCtxMsg(null);
    setForwardIds([mid]);
  }

  async function onCtxRecall() {
    if (!ctxMsg || !canRecall(ctxMsg)) return;
    const msg = ctxMsg;
    setCtxMsg(null);
    try {
      await recallMessage(msg.id, convId);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not recall message");
    }
  }

  function onCtxSelect() {
    if (!ctxMsg) return;
    const mid = ctxMsg.id;
    setCtxMsg(null);
    setSelectedIds((prev) => (prev.includes(mid) ? prev : [...prev, mid]));
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

      <View style={styles.threadWrap}>
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <Text style={styles.emptyThread}>No messages here yet…</Text>
          }
          renderItem={({ item }) => {
          if (item.recalled) {
            const label = item.mine
              ? "You recalled a message"
              : item.senderName
                ? `${item.senderName} recalled a message`
                : "Message recalled";
            return (
              <View style={styles.systemRow}>
                <Text style={styles.systemText}>{label}</Text>
              </View>
            );
          }

          const mine = Boolean(item.mine);
          const selected = selectedIds.includes(item.id);
          const isMedia =
            item.type === "image" ||
            item.type === "file" ||
            item.type === "voice" ||
            Boolean(item.mediaUrl);
          const time = fmtTime(item.createdAt);

          return (
            <Pressable
              onPress={() => {
                if (selecting) {
                  toggleSelect(item.id);
                  return;
                }
                setCtxMsg(item);
              }}
              onLongPress={() => {
                if (!selectedIds.includes(item.id)) {
                  setSelectedIds((prev) => [...prev, item.id]);
                }
              }}
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
                ]}
              >
                {selected ? (
                  <View style={[styles.checkBadge, mine ? styles.checkMine : styles.checkPeer]}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                ) : null}
                {!mine && item.senderName ? (
                  <Text style={styles.sender}>{item.senderName}</Text>
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
                <View style={styles.metaRow}>
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
        }}
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
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Pressable style={styles.send} onPress={onSend}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={Boolean(ctxMsg)}
        transparent
        animationType="fade"
        onRequestClose={() => setCtxMsg(null)}
      >
        <Pressable style={styles.modalBg} onPress={() => setCtxMsg(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle} numberOfLines={2}>
              {ctxMsg && !ctxMsg.recalled ? messageBody(ctxMsg) : "Message"}
            </Text>
            {ctxMsg && canForward(ctxMsg) ? (
              <Pressable style={styles.modalItem} onPress={onCtxForward}>
                <Ionicons name="arrow-redo-outline" size={20} color={colors.text} />
                <Text style={styles.modalItemText}>Forward</Text>
              </Pressable>
            ) : null}
            {ctxMsg && !ctxMsg.recalled && !ctxMsg.failed ? (
              <Pressable style={styles.modalItem} onPress={onCtxShare}>
                <Ionicons name="share-outline" size={20} color={colors.text} />
                <Text style={styles.modalItemText}>Share</Text>
              </Pressable>
            ) : null}
            {ctxMsg && canRecall(ctxMsg) ? (
              <Pressable style={styles.modalItem} onPress={onCtxRecall}>
                <Ionicons name="arrow-undo-outline" size={20} color={colors.danger} />
                <Text style={[styles.modalItemText, { color: colors.danger }]}>Recall</Text>
              </Pressable>
            ) : null}
            {ctxMsg && !ctxMsg.recalled ? (
              <Pressable style={styles.modalItem} onPress={onCtxSelect}>
                <Ionicons name="checkbox-outline" size={20} color={colors.text} />
                <Text style={styles.modalItemText}>Select</Text>
              </Pressable>
            ) : null}
            {ctxMsg?.mine ? (
              <Text style={styles.modalMeta}>
                Status:{" "}
                {ctxMsg.pending
                  ? "Sending"
                  : ctxMsg.failed
                    ? "Failed"
                    : ctxMsg.read
                      ? "Read"
                      : ctxMsg.delivered
                        ? "Delivered"
                        : "Sent"}
              </Text>
            ) : null}
            <Pressable style={styles.modalCancel} onPress={() => setCtxMsg(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#e8ebf0" },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingBottom: 10,
    backgroundColor: colors.headerBlue,
    minHeight: 52,
  },
  actionBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  actionCount: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 4,
    minWidth: 24,
  },
  actionSpacer: { flex: 1 },
  threadWrap: { flex: 1, position: "relative" },
  list: { padding: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
  jumpBottom: {
    position: "absolute",
    right: 16,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(36, 40, 48, 0.88)",
    alignItems: "center",
    justifyContent: "center",
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
    textAlign: "center",
    color: colors.textMuted,
    marginTop: spacing.xxl,
    fontSize: 14,
  },
  systemRow: {
    alignItems: "center",
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  systemText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
  bubbleWrap: { marginBottom: spacing.sm, flexDirection: "row" },
  bubbleWrapSelected: { opacity: 1 },
  mineWrap: { justifyContent: "flex-end" },
  peerWrap: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    minWidth: 72,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    position: "relative",
  },
  mine: {
    backgroundColor: colors.bubbleMine,
    borderBottomRightRadius: 4,
  },
  peer: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c5cbd6",
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
  peerSelected: { backgroundColor: "#e8f0fe", borderColor: colors.accent },
  checkBadge: {
    position: "absolute",
    top: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
    zIndex: 1,
  },
  checkMine: { left: -6 },
  checkPeer: { right: -6 },
  sender: { fontSize: 12, fontWeight: "600", color: colors.accent, marginBottom: 2 },
  body: { fontSize: 16, lineHeight: 22 },
  mineText: { color: "#fff" },
  peerText: { color: colors.text },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 140 },
  mediaIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaIconMine: { backgroundColor: "rgba(255,255,255,0.18)" },
  mediaIconPeer: { backgroundColor: "rgba(36,99,220,0.1)" },
  mediaTextCol: { flex: 1, minWidth: 0 },
  mediaTitle: { fontSize: 15, fontWeight: "600" },
  mediaDetail: { fontSize: 12, marginTop: 2 },
  fail: { fontSize: 11, color: "#fecaca", marginTop: 4 },
  failPeer: { fontSize: 11, color: colors.danger, marginTop: 4 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  metaTime: { fontSize: 11, fontWeight: "500" },
  metaTimeMine: { color: "rgba(255,255,255,0.88)" },
  metaTimePeer: { color: "#4b5563" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  send: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendText: { color: "#fff", fontWeight: "700" },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  modalTitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalItemText: { fontSize: 16, color: colors.text, fontWeight: "500" },
  modalMeta: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
  },
  modalCancel: {
    marginTop: spacing.md,
    alignItems: "center",
    paddingVertical: 12,
  },
  modalCancelText: { fontSize: 16, fontWeight: "600", color: colors.accent },
  forwardBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  forwardCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "85%",
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  forwardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  forwardSearch: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  forwardList: { maxHeight: 360 },
  forwardEmpty: {
    textAlign: "center",
    color: colors.textMuted,
    paddingVertical: spacing.lg,
  },
  forwardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  forwardRowText: { flex: 1, minWidth: 0 },
  forwardName: { fontSize: 15, fontWeight: "600", color: colors.text },
  forwardType: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  forwardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  forwardCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  forwardCancelText: { fontSize: 15, color: colors.textSecondary, fontWeight: "600" },
  forwardSend: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
  },
  forwardSendDisabled: { opacity: 0.45 },
  forwardSendText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
