import { useEffect, useMemo, useState } from "react";
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
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
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
import { isVideoAttachmentHint, isVideoMime } from "../lib/mediaLimits";
import { Message } from "../lib/types";
import { useTheme, useThemedStyles } from "../context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../theme";

const EMOJI_GRID = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘",
  "😎", "🤔", "🙄", "😢", "😭", "😡", "👍", "👎",
  "👏", "🙏", "🔥", "❤️", "💯", "🎉", "✨", "⭐",
  "🤝", "💪", "🫡", "🥳", "😴", "🤯", "😅", "😇",
];

function messagePreview(m: Message): string {
  if (m.type === "image") return m.content || "Photo";
  if (m.type === "file") {
    if (isVideoAttachmentHint(m.content, m.mediaUrl)) return m.content || "Video";
    return m.content || "File";
  }
  if (m.type === "voice") return m.content || "Voice message";
  return m.content || "";
}

export type MentionMember = {
  userId: string;
  username: string;
  displayName: string;
};

type MentionSuggestion = MentionMember & { everyone?: boolean };

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
  /** When true, typing @ in a group opens member autocomplete. */
  mentionEnabled?: boolean;
  mentionMembers?: MentionMember[];
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
  mentionEnabled = false,
  mentionMembers = [],
}: ChatComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recording = Boolean(recorderState?.isRecording);
  const hasText = text.trim().length > 0;
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [mentionMenu, setMentionMenu] = useState<{
    query: string;
    start: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      await AudioModule.requestRecordingPermissionsAsync().catch(() => {});
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      }).catch(() => {});
    })();
  }, []);

  useEffect(() => {
    if (!mentionEnabled) setMentionMenu(null);
  }, [mentionEnabled]);

  const mentionSuggestions = useMemo((): MentionSuggestion[] => {
    if (!mentionMenu || !mentionEnabled) return [];
    const q = mentionMenu.query.toLowerCase();
    const specials: MentionSuggestion[] =
      !q || "everyone".startsWith(q) || "all".startsWith(q)
        ? [
            {
              userId: "__everyone__",
              username: "everyone",
              displayName: "Notify everyone",
              everyone: true,
            },
          ]
        : [];
    const people = mentionMembers.filter((m) => {
      if (!q) return true;
      return (
        m.username.toLowerCase().startsWith(q) ||
        m.displayName.toLowerCase().includes(q)
      );
    });
    return [...specials, ...people].slice(0, 8);
  }, [mentionMenu, mentionEnabled, mentionMembers]);

  function updateMentionMenu(value: string, cursor: number) {
    if (!mentionEnabled) {
      setMentionMenu(null);
      return;
    }
    const before = value.slice(0, cursor);
    const m = before.match(/(^|[\s([{])@([a-zA-Z0-9_]*)$/);
    if (!m) {
      setMentionMenu(null);
      return;
    }
    setMentionMenu({
      query: m[2] || "",
      start: cursor - (m[2]?.length ?? 0) - 1,
    });
  }

  function applyMention(username: string) {
    if (!mentionMenu) return;
    const cursor = selection.start;
    const before = text.slice(0, mentionMenu.start);
    const after = text.slice(cursor);
    const insert = `@${username} `;
    const next = before + insert + after;
    const pos = before.length + insert.length;
    onChangeText(next);
    setMentionMenu(null);
    setSelection({ start: pos, end: pos });
  }

  function handleChangeText(v: string) {
    onChangeText(v);
    const cursor = Math.min(Math.max(selection.start, v.length), v.length);
    // Prefer end-of-edit when appending (common on mobile).
    const approx =
      v.length >= text.length ? v.length : Math.min(selection.start, v.length);
    updateMentionMenu(v, approx || cursor);
  }

  function handleSelectionChange(
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>
  ) {
    const next = e.nativeEvent.selection;
    setSelection(next);
    updateMentionMenu(text, next.start);
  }

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
    const name = a.name || "file";
    let mime = a.mimeType || "application/octet-stream";
    if (!isVideoMime(mime) && isVideoAttachmentHint(name)) {
      mime = "video/mp4";
    }
    const kind = mime.startsWith("image/") ? "image" : "file";
    onPickMedia(a.uri, kind, name, mime);
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

      {mentionSuggestions.length > 0 ? (
        <View style={styles.mentionMenu}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 180 }}>
            {mentionSuggestions.map((m) => (
              <Pressable
                key={m.userId}
                style={styles.mentionOption}
                onPress={() => applyMention(m.username)}
              >
                <Text style={styles.mentionName} numberOfLines={1}>
                  {m.everyone ? "@everyone" : `@${m.username}`}
                </Text>
                <Text style={styles.mentionHint} numberOfLines={1}>
                  {m.displayName}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
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
            onChangeText={handleChangeText}
            onSelectionChange={handleSelectionChange}
            selection={selection}
            placeholder={
              editing ? "Edit message" : mentionEnabled ? "Message · @ to mention" : "Message"
            }
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
              onPress={() => {
                setMentionMenu(null);
                onSend();
              }}
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

function makeStyles(c: ColorTokens) {
  return {
    wrap: {
      backgroundColor: c.bg,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    banner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
    },
    bannerBody: { flex: 1, minWidth: 0 },
    bannerTitle: { fontSize: 12, fontWeight: "700" as const, color: c.accent },
    bannerText: { fontSize: 13, color: c.textSecondary, marginTop: 1 },
    mentionMenu: {
      backgroundColor: "#1c1c1e",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#333",
      overflow: "hidden" as const,
    },
    mentionOption: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#2a2a2c",
    },
    mentionName: { color: "#fff", fontWeight: "700" as const, fontSize: 14 },
    mentionHint: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
    pill: {
      flexDirection: "row" as const,
      alignItems: "flex-end" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: 0,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.accent,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    recordBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
    recordText: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" as const },
    recordCancel: { paddingHorizontal: 8, paddingVertical: 6 },
    recordCancelText: { color: "#9ca3af", fontWeight: "600" as const },
    recordSend: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.accent,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emojiBg: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end" as const,
    },
    emojiSheet: {
      backgroundColor: "#1c1c1e",
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 12,
      paddingBottom: 28,
      maxHeight: "45%" as const,
    },
    emojiTitle: {
      color: "#fff",
      fontWeight: "700" as const,
      fontSize: 15,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    emojiGrid: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      paddingHorizontal: 10,
    },
    emojiCell: {
      width: "12.5%" as const,
      aspectRatio: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emojiGlyph: { fontSize: 26 },
  };
}
