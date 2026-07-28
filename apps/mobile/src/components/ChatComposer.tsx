import { useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
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
import { searchGifs, type GifItem } from "../lib/gifSearch";
import { isVideoAttachmentHint, isVideoMime, MESSAGE_MAX_CHARS, clipMessageText, messageCharCount } from "../lib/mediaLimits";
import { STICKER_PACKS } from "../lib/stickerData";
import { Message } from "../lib/types";
import { useTheme, useThemedStyles } from "../context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../theme";

const EMOJI_GRID = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘",
  "😎", "🤔", "🙄", "😢", "😭", "😡", "👍", "👎",
  "👏", "🙏", "🔥", "❤️", "💯", "🎉", "✨", "⭐",
  "🤝", "💪", "🫡", "🥳", "😴", "🤯", "😅", "😇",
];

type PickerTab = "emoji" | "stickers" | "gifs";

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
  onPickMedia: (
    uri: string,
    kind: "image" | "file",
    name: string,
    mimeType?: string,
    caption?: string
  ) => void;
  onSendVoice: (uri: string, durationSec: number) => void;
  /** Sticker / GIF remote image send (mirror web sendRemoteImage). */
  onSendRemoteImage?: (url: string, caption: string) => void;
  /** Throttled typing.start while the user types. */
  onTyping?: () => void;
  /** When true, typing @ in a group opens member autocomplete. */
  mentionEnabled?: boolean;
  mentionMembers?: MentionMember[];
  /** Group mute-all / speak-mute blocks sending. */
  disabled?: boolean;
  disabledReason?: string;
};

/**
 * Telegram-style dark pill composer: attach · text · emoji/sticker/gif · mic/send.
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
  onSendRemoteImage,
  onTyping,
  mentionEnabled = false,
  mentionMembers = [],
  disabled = false,
  disabledReason,
}: ChatComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>("emoji");
  const [stickerPackId, setStickerPackId] = useState(STICKER_PACKS[0]?.id ?? "smileys");
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [gifsLoading, setGifsLoading] = useState(false);
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recording = Boolean(recorderState?.isRecording);
  const hasText = text.trim().length > 0;
  const draftChars = messageCharCount(text);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [mentionMenu, setMentionMenu] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [mediaDraft, setMediaDraft] = useState<{
    uri: string;
    kind: "image" | "file";
    name: string;
    mimeType?: string;
    caption: string;
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

  useEffect(() => {
    if (!pickerOpen || pickerTab !== "gifs") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setGifsLoading(true);
      searchGifs(gifQuery)
        .then((list) => {
          if (!cancelled) setGifs(list);
        })
        .catch(() => {
          if (!cancelled) setGifs([]);
        })
        .finally(() => {
          if (!cancelled) setGifsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickerOpen, pickerTab, gifQuery]);

  const activePack = useMemo(
    () => STICKER_PACKS.find((p) => p.id === stickerPackId) ?? STICKER_PACKS[0],
    [stickerPackId]
  );

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
    onTyping?.();
    setMentionMenu(null);
    setSelection({ start: pos, end: pos });
  }

  function handleChangeText(v: string) {
    const clipped = clipMessageText(v);
    onChangeText(clipped);
    if (!disabled) onTyping?.();
    const approx =
      clipped.length >= text.length ? clipped.length : Math.min(selection.start, clipped.length);
    updateMentionMenu(clipped, approx);
  }

  function handleSelectionChange(
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>
  ) {
    const next = e.nativeEvent.selection;
    setSelection(next);
    updateMentionMenu(text, next.start);
  }

  function queueMediaDraft(
    uri: string,
    kind: "image" | "file",
    name: string,
    mimeType?: string
  ) {
    setMediaDraft({ uri, kind, name, mimeType, caption: "" });
  }

  async function pickPhoto() {
    if (disabled) return;
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
    queueMediaDraft(a.uri, "image", name, a.mimeType || "image/jpeg");
  }

  async function takePhoto() {
    if (disabled) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to take photos.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const name = a.fileName || `camera.${(a.uri.split(".").pop() || "jpg").split("?")[0]}`;
    queueMediaDraft(a.uri, "image", name, a.mimeType || "image/jpeg");
  }

  async function pickFile() {
    if (disabled) return;
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
    queueMediaDraft(a.uri, kind, name, mime);
  }

  function openAttach() {
    if (disabled) return;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Camera", "Photo library", "File"],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) takePhoto().catch(() => {});
          if (i === 2) pickPhoto().catch(() => {});
          if (i === 3) pickFile().catch(() => {});
        }
      );
      return;
    }
    Alert.alert("Attach", undefined, [
      { text: "Camera", onPress: () => takePhoto().catch(() => {}) },
      { text: "Photo library", onPress: () => pickPhoto().catch(() => {}) },
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
    if (disabled) return;
    onChangeText(clipMessageText(text + emoji));
    onTyping?.();
  }

  function sendRemote(url: string, caption: string) {
    if (disabled || !onSendRemoteImage || !url) return;
    onSendRemoteImage(url, caption);
    setPickerOpen(false);
  }

  const packLabels: Record<string, string> = {
    smileys: "Smileys",
    animals: "Animals",
    gestures: "Gestures",
    celebration: "Celebration",
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {disabled && disabledReason ? (
        <View style={styles.muteBanner}>
          <Ionicons name="mic-off-outline" size={16} color="#fbbf24" />
          <Text style={styles.muteBannerText}>{disabledReason}</Text>
        </View>
      ) : null}
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

      {recording && !disabled ? (
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
        <View style={[styles.pill, disabled && styles.pillDisabled]}>
          <Pressable
            style={styles.iconBtn}
            onPress={openAttach}
            accessibilityLabel="Attach"
            hitSlop={6}
            disabled={disabled}
          >
            <Ionicons name="attach" size={22} color={disabled ? "#6b7280" : "#b0b0b0"} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={handleChangeText}
            onSelectionChange={handleSelectionChange}
            selection={selection}
            editable={!disabled}
            placeholder={
              disabled
                ? disabledReason || "Messaging disabled"
                : editing
                  ? "Edit message"
                  : mentionEnabled
                    ? "Message · @ to mention"
                    : "Message"
            }
            placeholderTextColor="#8e8e93"
            multiline
            maxLength={MESSAGE_MAX_CHARS}
          />
          {draftChars >= MESSAGE_MAX_CHARS - 50 ? (
            <Text
              style={[
                styles.charCount,
                draftChars >= MESSAGE_MAX_CHARS && styles.charCountWarn,
              ]}
            >
              {draftChars}/{MESSAGE_MAX_CHARS}
            </Text>
          ) : null}
          <Pressable
            style={styles.iconBtn}
            onPress={() => !disabled && setPickerOpen(true)}
            accessibilityLabel="Emoji stickers GIFs"
            hitSlop={6}
            disabled={disabled}
          >
            <Ionicons name="happy-outline" size={22} color={disabled ? "#6b7280" : "#b0b0b0"} />
          </Pressable>
          {hasText || editing ? (
            <Pressable
              style={[styles.sendBtn, disabled && styles.sendBtnDisabled]}
              onPress={() => {
                if (disabled) return;
                setMentionMenu(null);
                onSend();
              }}
              accessibilityLabel={editing ? "Save" : "Send"}
              disabled={disabled}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              style={[styles.micBtn, disabled && styles.sendBtnDisabled]}
              onPress={() => {
                if (!disabled) startRecording().catch(() => {});
              }}
              accessibilityLabel="Voice message"
              disabled={disabled}
            >
              <Ionicons name="mic" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      <Modal
        visible={Boolean(mediaDraft)}
        transparent
        animationType="fade"
        onRequestClose={() => setMediaDraft(null)}
      >
        <Pressable style={styles.emojiBg} onPress={() => setMediaDraft(null)}>
          <Pressable style={styles.captionSheet} onPress={() => {}}>
            <Text style={styles.captionTitle}>
              {mediaDraft?.kind === "image" ? "Send photo" : "Send file"}
            </Text>
            {mediaDraft?.kind === "image" ? (
              <Image source={{ uri: mediaDraft.uri }} style={styles.captionPreview} />
            ) : (
              <Text style={styles.captionFileName} numberOfLines={2}>
                {mediaDraft?.name}
              </Text>
            )}
            <TextInput
              style={styles.captionInput}
              value={mediaDraft?.caption ?? ""}
              onChangeText={(v) =>
                setMediaDraft((prev) =>
                  prev ? { ...prev, caption: clipMessageText(v) } : prev
                )
              }
              placeholder="Add a caption (optional)"
              placeholderTextColor="#8e8e93"
              multiline
              maxLength={MESSAGE_MAX_CHARS}
            />
            <View style={styles.captionActions}>
              <Pressable style={styles.captionCancel} onPress={() => setMediaDraft(null)}>
                <Text style={styles.captionCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.captionSend}
                onPress={() => {
                  if (!mediaDraft) return;
                  onPickMedia(
                    mediaDraft.uri,
                    mediaDraft.kind,
                    mediaDraft.name,
                    mediaDraft.mimeType,
                    mediaDraft.caption.trim() || undefined
                  );
                  setMediaDraft(null);
                }}
              >
                <Text style={styles.captionSendText}>Send</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={pickerOpen && !disabled}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.emojiBg} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.emojiSheet} onPress={() => {}}>
            <View style={styles.pickerTabs}>
              {(
                [
                  ["emoji", "Emoji"],
                  ["stickers", "Stickers"],
                  ["gifs", "GIFs"],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  style={[styles.pickerTab, pickerTab === id && styles.pickerTabActive]}
                  onPress={() => setPickerTab(id)}
                >
                  <Text
                    style={[
                      styles.pickerTabText,
                      pickerTab === id && styles.pickerTabTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {pickerTab === "emoji" ? (
              <ScrollView contentContainerStyle={styles.emojiGrid}>
                {EMOJI_GRID.map((e) => (
                  <Pressable
                    key={e}
                    style={styles.emojiCell}
                    onPress={() => {
                      insertEmoji(e);
                      setPickerOpen(false);
                    }}
                  >
                    <Text style={styles.emojiGlyph}>{e}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {pickerTab === "stickers" ? (
              <View style={{ flex: 1 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.packRow}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
                >
                  {STICKER_PACKS.map((p) => (
                    <Pressable
                      key={p.id}
                      style={[
                        styles.packChip,
                        stickerPackId === p.id && styles.packChipActive,
                      ]}
                      onPress={() => setStickerPackId(p.id)}
                    >
                      <Text style={styles.packChipText}>
                        {packLabels[p.id] || p.id}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView contentContainerStyle={styles.stickerGrid}>
                  {(activePack?.stickers ?? []).map((s) => (
                    <Pressable
                      key={s.id}
                      style={styles.stickerCell}
                      onPress={() => sendRemote(s.url, "Sticker")}
                    >
                      <Image source={{ uri: s.url }} style={styles.stickerImg} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {pickerTab === "gifs" ? (
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.gifSearch}
                  value={gifQuery}
                  onChangeText={setGifQuery}
                  placeholder="Search GIFs"
                  placeholderTextColor="#8e8e93"
                  autoCorrect={false}
                />
                {gifsLoading ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
                ) : (
                  <ScrollView contentContainerStyle={styles.gifGrid}>
                    {gifs.map((g) => (
                      <Pressable
                        key={g.id}
                        style={styles.gifCell}
                        onPress={() => sendRemote(g.url, "GIF")}
                      >
                        <Image
                          source={{ uri: g.previewUrl }}
                          style={styles.gifImg}
                          resizeMode="cover"
                        />
                      </Pressable>
                    ))}
                    {!gifs.length ? (
                      <Text style={styles.gifEmpty}>No GIFs found</Text>
                    ) : null}
                  </ScrollView>
                )}
              </View>
            ) : null}
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
    muteBanner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      backgroundColor: "rgba(251,191,36,0.12)",
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
    },
    muteBannerText: { flex: 1, color: "#fbbf24", fontSize: 13, fontWeight: "600" as const },
    pillDisabled: { opacity: 0.72 },
    charCount: { fontSize: 11, color: "#9ca3af", alignSelf: "center" as const, marginRight: 2 },
    charCountWarn: { color: "#f87171", fontWeight: "700" as const },
    sendBtnDisabled: { opacity: 0.45 },
    captionSheet: {
      backgroundColor: "#1c1c1e",
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
      gap: 12,
      marginTop: "auto" as const,
    },
    captionTitle: { color: "#fff", fontSize: 16, fontWeight: "700" as const },
    captionPreview: { width: "100%" as const, height: 180, borderRadius: 12, backgroundColor: "#111" },
    captionFileName: { color: "#d1d5db", fontSize: 14 },
    captionInput: {
      minHeight: 72,
      maxHeight: 120,
      borderRadius: 12,
      backgroundColor: "#111",
      color: "#fff",
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    captionActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 10 },
    captionCancel: { paddingHorizontal: 14, paddingVertical: 10 },
    captionCancelText: { color: "#9ca3af", fontWeight: "600" as const },
    captionSend: {
      backgroundColor: c.accent,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    captionSendText: { color: "#fff", fontWeight: "700" as const },
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
      maxHeight: "58%" as const,
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
    pickerTabs: {
      flexDirection: "row" as const,
      gap: 8,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    pickerTab: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: "#2a2a2c",
    },
    pickerTabActive: { backgroundColor: c.accent },
    pickerTabText: { color: "#9ca3af", fontWeight: "700" as const, fontSize: 13 },
    pickerTabTextActive: { color: "#fff" },
    packRow: { maxHeight: 44, marginBottom: 8 },
    packChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: "#2a2a2c",
    },
    packChipActive: { backgroundColor: c.accent },
    packChipText: { color: "#fff", fontWeight: "600" as const, fontSize: 12 },
    stickerGrid: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      paddingHorizontal: 10,
      paddingBottom: 12,
    },
    stickerCell: {
      width: "25%" as const,
      aspectRatio: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 6,
    },
    stickerImg: { width: 56, height: 56 },
    gifSearch: {
      marginHorizontal: 12,
      marginBottom: 8,
      borderRadius: 10,
      backgroundColor: "#2a2a2c",
      color: "#fff",
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    gifGrid: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      paddingHorizontal: 8,
      paddingBottom: 12,
      gap: 6,
    },
    gifCell: {
      width: "48%" as const,
      aspectRatio: 1.2,
      borderRadius: 10,
      overflow: "hidden" as const,
      backgroundColor: "#2a2a2c",
    },
    gifImg: { width: "100%" as const, height: "100%" as const },
    gifEmpty: { color: "#9ca3af", padding: 16, width: "100%" as const, textAlign: "center" as const },
  };
}
