import { useEffect, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Message } from "../lib/types";
import { colors, radius, spacing } from "../theme";

const EMOJI_GRID = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘",
  "😎", "🤔", "🙄", "😢", "😭", "😡", "👍", "👎",
  "👏", "🙏", "🔥", "❤️", "💯", "🎉", "✨", "⭐",
  "🤝", "💪", "🫡", "🥳", "😴", "🤯", "😅", "😇",
];

function messagePreview(m: Message): string {
  if (m.type === "image") return m.content || "Photo";
  if (m.type === "file") return m.content || "File";
  if (m.type === "voice") return m.content || "Voice message";
  return m.content || "";
}

export type ChatComposerProps = {
  text: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  editing: Message | null;
  replyTo: Message | null;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onPickMedia: (uri: string, kind: "image" | "file", name: string, mimeType?: string) => void;
  onSendVoice: (uri: string, durationSec: number) => void;
};

/**
 * Telegram-style dark pill composer: attach · text · emoji · mic/send.
 * Mobile-only UI.
 */
export function ChatComposer({
  text,
  onChangeText,
  onSend,
  editing,
  replyTo,
  onCancelEdit,
  onCancelReply,
  onPickMedia,
  onSendVoice,
}: ChatComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recording = Boolean(recorderState?.isRecording);
  const hasText = text.trim().length > 0;

  useEffect(() => {
    (async () => {
      await AudioModule.requestRecordingPermissionsAsync().catch(() => {});
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      }).catch(() => {});
    })();
  }, []);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to send images.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const name = a.fileName || `photo.${(a.uri.split(".").pop() || "jpg").split("?")[0]}`;
    onPickMedia(a.uri, "image", name, a.mimeType || "image/jpeg");
  }

  async function pickFile() {
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const mime = a.mimeType || "application/octet-stream";
    const kind = mime.startsWith("image/") ? "image" : "file";
    onPickMedia(a.uri, kind, a.name || "file", mime);
  }

  function openAttach() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Photo", "File"],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) pickPhoto().catch(() => {});
          if (i === 2) pickFile().catch(() => {});
        }
      );
      return;
    }
    Alert.alert("Attach", undefined, [
      { text: "Photo", onPress: () => pickPhoto().catch(() => {}) },
      { text: "File", onPress: () => pickFile().catch(() => {}) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow microphone access to send voice messages.");
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not start recording");
    }
  }

  async function stopRecording(send: boolean) {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const durationMs = Number(recorderState?.durationMillis ?? 0);
      const durationSec = Math.max(1, Math.round(durationMs / 1000));
      if (send && uri) {
        onSendVoice(uri, durationSec);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not stop recording");
    } finally {
      setVoiceBusy(false);
    }
  }

  function insertEmoji(emoji: string) {
    onChangeText(text + emoji);
  }

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {editing ? (
        <View style={styles.banner}>
          <Ionicons name="pencil-outline" size={18} color={colors.accent} />
          <View style={styles.bannerBody}>
            <Text style={styles.bannerTitle}>Edit message</Text>
            <Text style={styles.bannerText} numberOfLines={1}>
              {messagePreview(editing)}
            </Text>
          </View>
          <Pressable onPress={onCancelEdit} hitSlop={8}>
            <Ionicons name="close" size={20} color="#9ca3af" />
          </Pressable>
        </View>
      ) : replyTo ? (
        <View style={styles.banner}>
          <Ionicons name="arrow-undo-outline" size={18} color={colors.accent} />
          <View style={styles.bannerBody}>
            <Text style={styles.bannerTitle}>
              Reply to {replyTo.mine ? "You" : replyTo.senderName || "User"}
            </Text>
            <Text style={styles.bannerText} numberOfLines={1}>
              {messagePreview(replyTo)}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Ionicons name="close" size={20} color="#9ca3af" />
          </Pressable>
        </View>
      ) : null}

      {recording ? (
        <View style={styles.recordBar}>
          <View style={styles.recordDot} />
          <Text style={styles.recordText}>
            Recording… {Math.max(0, Math.round((recorderState?.durationMillis ?? 0) / 1000))}s
          </Text>
          <Pressable style={styles.recordCancel} onPress={() => stopRecording(false)}>
            <Text style={styles.recordCancelText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.recordSend} onPress={() => stopRecording(true)}>
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={styles.pill}>
          <Pressable
            style={styles.iconBtn}
            onPress={openAttach}
            accessibilityLabel="Attach"
            hitSlop={6}
          >
            <Ionicons name="attach" size={22} color="#b0b0b0" />
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={onChangeText}
            placeholder={editing ? "Edit message" : "Message"}
            placeholderTextColor="#8e8e93"
            multiline
            maxLength={1000}
          />
          <Pressable
            style={styles.iconBtn}
            onPress={() => setEmojiOpen(true)}
            accessibilityLabel="Emoji"
            hitSlop={6}
          >
            <Ionicons name="happy-outline" size={22} color="#b0b0b0" />
          </Pressable>
          {hasText || editing ? (
            <Pressable
              style={styles.sendBtn}
              onPress={onSend}
              accessibilityLabel={editing ? "Save" : "Send"}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              style={styles.micBtn}
              onPress={startRecording}
              accessibilityLabel="Voice message"
            >
              <Ionicons name="mic" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      <Modal
        visible={emojiOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEmojiOpen(false)}
      >
        <Pressable style={styles.emojiBg} onPress={() => setEmojiOpen(false)}>
          <Pressable style={styles.emojiSheet} onPress={() => {}}>
            <Text style={styles.emojiTitle}>Emoji</Text>
            <ScrollView contentContainerStyle={styles.emojiGrid}>
              {EMOJI_GRID.map((e) => (
                <Pressable
                  key={e}
                  style={styles.emojiCell}
                  onPress={() => {
                    insertEmoji(e);
                    setEmojiOpen(false);
                  }}
                >
                  <Text style={styles.emojiGlyph}>{e}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#e8ebf0",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  bannerBody: { flex: 1, minWidth: 0 },
  bannerTitle: { fontSize: 12, fontWeight: "700", color: colors.accent },
  bannerText: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#1c1c1e",
    borderRadius: 999,
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 48,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    paddingHorizontal: 4,
    fontSize: 16,
    color: "#fff",
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#9b8cff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  recordBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1c1c1e",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
  },
  recordDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ef4444",
  },
  recordText: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" },
  recordCancel: { paddingHorizontal: 8, paddingVertical: 6 },
  recordCancelText: { color: "#9ca3af", fontWeight: "600" },
  recordSend: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  emojiSheet: {
    backgroundColor: "#1c1c1e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: "45%",
  },
  emojiTitle: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
  },
  emojiCell: {
    width: "12.5%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiGlyph: { fontSize: 26 },
});
