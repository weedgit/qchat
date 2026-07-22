import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
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
import { conversationDisplayName } from "../../src/lib/types";
import { colors, radius, spacing } from "../../src/theme";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = String(id);
  const navigation = useNavigation();
  const { conversations, messages, openConversation, sendMessage } = useChat();
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
        renderItem={({ item }) => {
          const mine = Boolean(item.mine);
          return (
            <View style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.peerWrap]}>
              <View style={[styles.bubble, mine ? styles.mine : styles.peer]}>
                {!mine && item.senderName ? (
                  <Text style={styles.sender}>{item.senderName}</Text>
                ) : null}
                <Text style={[styles.body, mine ? styles.mineText : styles.peerText]}>
                  {item.recalled ? "消息已撤回" : item.content}
                </Text>
                {item.pending ? <Text style={styles.status}>发送中…</Text> : null}
                {item.failed ? <Text style={styles.fail}>发送失败</Text> : null}
              </View>
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="输入消息"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <Pressable style={styles.send} onPress={onSend}>
          <Text style={styles.sendText}>发送</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, paddingBottom: spacing.lg },
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
