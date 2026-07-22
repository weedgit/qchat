import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = String(id);
  const navigation = useNavigation();
  const { conversations, messages, openConversation, sendMessage, recallMessage } = useChat();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === convId) ?? null,
    [conversations, convId]
  );
  const list = messages[convId] ?? [];

  useEffect(() => {
    openConversation(convId);
  }, [convId, openConversation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversation ? conversationDisplayName(conversation) : "Chat",
    });
  }, [navigation, conversation]);

  useEffect(() => {
    if (list.length === 0) return;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [list.length]);

  async function onSend() {
    const body = text.trim();
    if (!body) return;
    setText("");
    await sendMessage(convId, body);
  }

  function onLongPressMessage(item: Message) {
    if (!item.mine || item.recalled || item.pending || item.failed) return;
    Alert.alert("Message", undefined, [
      {
        text: "Recall",
        style: "destructive",
        onPress: () => {
          recallMessage(item.id, convId).catch((e: any) => {
            Alert.alert("Error", e?.message || "Could not recall message");
          });
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={listRef}
        data={list}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyThread}>No messages here yet…</Text>
        }
        renderItem={({ item }) => {
          // Mirror web/Mattermost delete: recalled → system status, not a bubble.
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
          const isMedia =
            item.type === "image" ||
            item.type === "file" ||
            item.type === "voice" ||
            Boolean(item.mediaUrl);
          return (
            <Pressable
              onLongPress={() => onLongPressMessage(item)}
              delayLongPress={350}
              style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.peerWrap]}
            >
              <View style={[styles.bubble, mine ? styles.mine : styles.peer]}>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  mineWrap: { justifyContent: "flex-end" },
  peerWrap: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  mine: { backgroundColor: colors.bubbleMine },
  peer: {
    backgroundColor: colors.bubblePeer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
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
