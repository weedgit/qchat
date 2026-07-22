import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useChat } from "../../src/context/ChatContext";
import { Message, conversationDisplayName } from "../../src/lib/types";
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

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = String(id);
  const navigation = useNavigation();
  const { conversations, messages, openConversation, sendMessage, recallMessage } = useChat();
  const [text, setText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const listRef = useRef<FlatList>(null);

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

  const canCopy = selectedMsgs.some((m) => !m.recalled && Boolean(messageBody(m).trim()));
  const canRecallSelected =
    selectedMsgs.length > 0 && selectedMsgs.every((m) => canRecall(m));

  useEffect(() => {
    openConversation(convId);
  }, [convId, openConversation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !selecting,
      title: conversation ? conversationDisplayName(conversation) : "Chat",
    });
  }, [navigation, conversation, selecting]);

  useEffect(() => {
    if (list.length === 0) return;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [list.length]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

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

  async function onCopy() {
    const parts = selectedMsgs
      .filter((m) => !m.recalled)
      .map((m) => messageBody(m).trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    // Share works without a native rebuild; expo-clipboard needs a new dev client.
    await Share.share({ message: parts.join("\n") });
    clearSelection();
  }

  async function onRecall() {
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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      {selecting ? (
        <View style={styles.actionBar}>
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
          {canCopy ? (
            <Pressable
              style={styles.actionBtn}
              onPress={onCopy}
              hitSlop={8}
              accessibilityLabel="Share"
            >
              <Ionicons name="share-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
          {canRecallSelected ? (
            <Pressable
              style={styles.actionBtn}
              onPress={onRecall}
              hitSlop={8}
              accessibilityLabel="Recall"
            >
              <Ionicons name="arrow-undo-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={list}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
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

          return (
            <Pressable
              onPress={() => {
                if (selecting) toggleSelect(item.id);
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
                  <Text style={[styles.mediaLabel, mine ? styles.mineText : styles.peerText]}>
                    {item.type === "image"
                      ? "🖼 Photo"
                      : item.type === "voice"
                        ? "🎤 Voice message"
                        : "📎 File"}
                    {item.content &&
                    item.content !== "Photo" &&
                    item.content !== "File" &&
                    item.content !== "Voice message"
                      ? `\n${item.content}`
                      : ""}
                  </Text>
                ) : (
                  <Text style={[styles.body, mine ? styles.mineText : styles.peerText]}>
                    {messageBody(item)}
                  </Text>
                )}
                {item.pending ? <Text style={styles.status}>Sending…</Text> : null}
                {item.failed ? <Text style={styles.fail}>Failed to send</Text> : null}
              </View>
            </Pressable>
          );
        }}
      />

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
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
  list: { padding: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
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
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: "relative",
  },
  mine: { backgroundColor: colors.bubbleMine },
  peer: {
    backgroundColor: colors.bubblePeer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
  sender: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  body: { fontSize: 16, lineHeight: 22 },
  mediaLabel: { fontSize: 15, lineHeight: 22 },
  mineText: { color: "#fff" },
  peerText: { color: colors.text },
  status: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 4 },
  fail: { fontSize: 11, color: "#fecaca", marginTop: 4 },
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
});
