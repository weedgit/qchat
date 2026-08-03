import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
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
import { ResizeMode, Video } from "expo-av";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatSystemNotice } from "@qchat/i18n";
import { Avatar } from "../../src/components/Avatar";
import { ChatComposer, type MentionMember } from "../../src/components/ChatComposer";
import {
  GroupCallInviteSheet,
  loadGroupCallInviteMembers,
  type GroupCallInviteMember,
} from "../../src/components/GroupCallInviteSheet";
import { MessageBody } from "../../src/components/MessageBody";
import { MessageActionPopup } from "../../src/components/MessageActionPopup";
import { VoiceNotePlayer } from "../../src/components/VoiceNotePlayer";
import { useAuth } from "../../src/context/AuthContext";
import { useChat } from "../../src/context/ChatContext";
import { useCallApi } from "../../src/context/CallContext";
import { api, asList, mediaAuthURL } from "../../src/lib/api";
import { alertSaveResult, saveChatMedia } from "../../src/lib/saveMedia";
import type { CallKind } from "../../src/lib/useCall";
import { getDraft, saveDraft } from "../../src/lib/drafts";
import { isVideoAttachmentHint } from "../../src/lib/mediaLimits";
import { maybeAnimateStickerUrl } from "../../src/lib/stickerData";
import { Conversation, Message, Reaction, conversationDisplayName, formatLastSeen } from "../../src/lib/types";
import {
  nextPinnedFromScroll,
  previousPinnedInCycle,
  type PinnedMessage,
} from "../../src/lib/pinnedCycle";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../../src/theme";

function messageBody(item: Message): string {
  if (item.type === "image") return item.content || "Photo";
  if (item.type === "file") {
    if (isVideoAttachmentHint(item.content, item.mediaUrl)) return item.content || "Video";
    return item.content || "File";
  }
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
function showGroupReceiptDetails(msg: Message) {
  if (msg.memberCount == null || msg.memberCount <= 0) return;
  const n = msg.readCount ?? msg.readBy?.length ?? 0;
  const readNames =
    (msg.readBy?.length ?? 0) === 0
      ? "Nobody yet"
      : msg.readBy!.map((u) => u.displayName).join("\n");
  const unreadNames =
    (msg.unreadBy?.length ?? 0) === 0
      ? "Everyone"
      : msg.unreadBy!.map((u) => u.displayName).join("\n");
  Alert.alert(`${n}/${msg.memberCount} read`, `Read\n${readNames}\n\nUnread\n${unreadNames}`);
}

function ReceiptIcons({
  msg,
  onPressGroupReceipt,
}: {
  msg: Message;
  onPressGroupReceipt?: () => void;
}) {
  if (!msg.mine || msg.recalled) return null;
  if (msg.pending) {
    return <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.75)" />;
  }
  if (msg.failed) {
    return <Ionicons name="alert-circle" size={12} color="#fecaca" />;
  }
  if (msg.memberCount != null && msg.memberCount > 0) {
    const n = msg.readCount ?? msg.readBy?.length ?? 0;
    const label = (
      <Text style={receiptCountStyle}>
        {n}/{msg.memberCount}
      </Text>
    );
    if (onPressGroupReceipt) {
      return (
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onPressGroupReceipt();
          }}
          hitSlop={8}
        >
          {label}
        </Pressable>
      );
    }
    return label;
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

const receiptCountStyle = {
  fontSize: 11,
  fontWeight: "500" as const,
  color: "rgba(255,255,255,0.88)",
};

function MediaBody({
  item,
  mine,
  onOpenImage,
}: {
  item: Message;
  mine: boolean;
  onOpenImage?: (uri: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isVideo =
    (item.type === "file" || item.type === "video") &&
    Boolean(item.mediaUrl) &&
    isVideoAttachmentHint(item.content, item.mediaUrl);
  const icon =
    item.type === "image"
      ? "image-outline"
      : item.type === "voice"
        ? "mic-outline"
        : isVideo
          ? "videocam-outline"
          : "document-outline";
  const label =
    item.type === "image"
      ? "Photo"
      : item.type === "voice"
        ? "Voice message"
        : isVideo
          ? "Video"
          : "File";
  const detail =
    item.content &&
    item.content !== "Photo" &&
    item.content !== "File" &&
    item.content !== "Video" &&
    item.content !== "Voice message"
      ? item.content
      : null;
  const tint = mine ? "#fff" : colors.text;
  const subTint = mine ? "rgba(255,255,255,0.8)" : colors.textMuted;
  const videoUri = isVideo ? mediaAuthURL(item.mediaUrl) || item.mediaUrl : undefined;
  const imageUri =
    item.type === "image" && item.mediaUrl
      ? mediaAuthURL(item.mediaUrl) || item.mediaUrl
      : undefined;
  const displayImageUri = imageUri ? maybeAnimateStickerUrl(imageUri) : undefined;
  const voiceUri =
    item.type === "voice" && item.mediaUrl
      ? mediaAuthURL(item.mediaUrl) || item.mediaUrl
      : undefined;
  const fileUri =
    item.type === "file" && !isVideo && item.mediaUrl
      ? mediaAuthURL(item.mediaUrl) || item.mediaUrl
      : undefined;

  async function openFile() {
    if (!fileUri) return;
    try {
      const can = await Linking.canOpenURL(fileUri);
      if (can) {
        await Linking.openURL(fileUri);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      await Share.share({ url: fileUri, message: detail || label });
    } catch {
      Alert.alert("Could not open file", "Copy the link from another device if this persists.");
    }
  }

  if (displayImageUri) {
    return (
      <View style={styles.videoCol}>
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onOpenImage?.(displayImageUri);
          }}
        >
          <Image source={{ uri: displayImageUri }} style={styles.imagePreview} resizeMode="cover" />
        </Pressable>
        {detail ? (
          <MessageBody
            text={detail}
            style={[styles.mediaDetail, { color: subTint }]}
            mentionStyle={mine ? styles.mentionMine : styles.mentionPeer}
            linkStyle={mine ? styles.linkMine : styles.linkPeer}
          />
        ) : null}
      </View>
    );
  }

  if (voiceUri) {
    return (
      <VoiceNotePlayer
        uri={voiceUri}
        label={label}
        detail={detail}
        tint={tint}
        subTint={subTint}
        mine={mine}
      />
    );
  }

  if (isVideo && videoUri) {
    return (
      <View style={styles.videoCol}>
        <Pressable onPress={(e) => e?.stopPropagation?.()}>
          <Video
            source={{ uri: videoUri }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            style={styles.videoPlayer}
          />
        </Pressable>
        {detail ? (
          <MessageBody
            text={detail}
            style={[styles.mediaDetail, { color: subTint }]}
            mentionStyle={mine ? styles.mentionMine : styles.mentionPeer}
            linkStyle={mine ? styles.linkMine : styles.linkPeer}
          />
        ) : (
          <Text style={[styles.mediaTitle, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.mediaRow}
      onPress={(e) => {
        e?.stopPropagation?.();
        void openFile();
      }}
    >
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
        ) : fileUri ? (
          <Text style={[styles.mediaDetail, { color: subTint }]} numberOfLines={1}>
            Tap to open
          </Text>
        ) : null}
      </View>
    </Pressable>
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
  onRetry?: (item: Message) => void;
  onCancelUpload?: (item: Message) => void;
  onReactChip?: (item: Message, emoji: string) => void;
  onOpenImage?: (uri: string) => void;
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
  onRetry,
  onCancelUpload,
  onReactChip,
  onOpenImage,
}: ChatMessageRowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (item.type === "system") {
    const label = formatSystemNotice(item.content || "");
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{label}</Text>
      </View>
    );
  }
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
          <MediaBody item={item} mine={mine} onOpenImage={onOpenImage} />
        ) : (
          <MessageBody
            text={messageBody(item)}
            style={[styles.body, mine ? styles.mineText : styles.peerText]}
            mentionStyle={mine ? styles.mentionMine : styles.mentionPeer}
            linkStyle={mine ? styles.linkMine : styles.linkPeer}
            codeStyle={mine ? styles.codeMine : styles.codePeer}
          />
        )}
        {item.pending && typeof item.uploadProgress === "number" ? (
          <View style={styles.uploadRow}>
            <View style={styles.uploadTrack}>
              <View
                style={[
                  styles.uploadFill,
                  { width: `${Math.round(item.uploadProgress * 100)}%` },
                ]}
              />
            </View>
            {onCancelUpload ? (
              <Pressable
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onCancelUpload(item);
                }}
                hitSlop={8}
                accessibilityLabel="Cancel upload"
              >
                <Ionicons name="close-circle" size={18} color={mine ? "#fecaca" : colors.danger} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {item.failed ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onRetry?.(item);
            }}
          >
            <Text style={mine ? styles.fail : styles.failPeer}>
              {item.error ? `${item.error} · Tap to retry` : "Failed to send · Tap to retry"}
            </Text>
          </Pressable>
        ) : null}
        {(item.reactions?.length ?? 0) > 0 ? (
          <View style={styles.reactionRow}>
            {item.reactions!.map((r: Reaction) => (
              <Pressable
                key={r.emoji}
                style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onReactChip?.(item, r.emoji);
                }}
              >
                <Text style={styles.reactionChipText}>
                  {r.emoji} {r.count > 1 ? r.count : ""}
                </Text>
              </Pressable>
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
          {item.editedAt && !item.recalled ? (
            <Text style={[styles.metaTime, mine ? styles.metaTimeMine : styles.metaTimePeer]}>
              edited
            </Text>
          ) : null}
          {time ? (
            <Text style={[styles.metaTime, mine ? styles.metaTimeMine : styles.metaTimePeer]}>
              {time}
            </Text>
          ) : null}
          {mine ? (
            <ReceiptIcons
              msg={item}
              onPressGroupReceipt={
                item.memberCount != null && item.memberCount > 0
                  ? () => showGroupReceiptDetails(item)
                  : undefined
              }
            />
          ) : null}
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
  loadingOlder?: boolean;
  historyComplete?: boolean;
  onViewableItemsChanged: (info: {
    viewableItems: Array<{ index: number | null }>;
  }) => void;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
  onPressMessage: (item: Message) => void;
  onLongPressMessage: (item: Message) => void;
  onPressReply?: (replyToId: string) => void;
  onRetry?: (item: Message) => void;
  onCancelUpload?: (item: Message) => void;
  onReactChip?: (item: Message, emoji: string) => void;
  onOpenImage?: (uri: string) => void;
};

const ChatMessageList = memo(function ChatMessageList({
  list,
  selectedSet,
  pinnedIdSet,
  highlightedId,
  showSender,
  listRef,
  onScroll,
  loadingOlder,
  historyComplete,
  onViewableItemsChanged,
  viewabilityConfig,
  onPressMessage,
  onLongPressMessage,
  onPressReply,
  onRetry,
  onCancelUpload,
  onReactChip,
  onOpenImage,
}: ChatMessageListProps) {
  const styles = useThemedStyles(makeStyles);
  const keyExtractor = useCallback((m: Message) => m.id, []);
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list]);
  const listHeader = useMemo(() => {
    if (!loadingOlder && !historyComplete) return null;
    return (
      <Text style={styles.emptyThread}>
        {loadingOlder ? "Loading earlier messages…" : "Beginning of history"}
      </Text>
    );
  }, [historyComplete, loadingOlder, styles.emptyThread]);
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
        onRetry={onRetry}
        onCancelUpload={onCancelUpload}
        onReactChip={onReactChip}
        onOpenImage={onOpenImage}
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
      onRetry,
      onCancelUpload,
      onReactChip,
      onOpenImage,
    ]
  );

  return (
    <FlatList
      ref={listRef}
      data={list}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      extraData={`${selectedSet.size}:${highlightedId ?? ""}:${loadingOlder ? 1 : 0}`}
      contentContainerStyle={styles.list}
      onScroll={onScroll}
      scrollEventThrottle={32}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
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

/** Mirror web ForwardPicker / ForwardPostModal. */
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
    hasMoreByConv,
    loadOlderMessages,
    openConversation,
    closeConversation,
    sendMessage,
    recallMessage,
    forwardMessage,
    reactMessage,
    pinMessage,
    editMessage,
    sendMediaMessage,
    sendRemoteImage,
    sendVoiceMessage,
    retryMessage,
    cancelUpload,
    typingByConv,
    presenceByUser,
    notifyTyping,
    subscribeEvents,
  } = useChat();
  const { user } = useAuth();
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
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [mentionMembers, setMentionMembers] = useState<MentionMember[]>([]);
  const [myMuteUntil, setMyMuteUntil] = useState<string | undefined>(undefined);
  const [groupMuteAll, setGroupMuteAll] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [groupCallInvite, setGroupCallInvite] = useState<CallKind | null>(null);
  const [groupCallInviteBusy, setGroupCallInviteBusy] = useState(false);
  const [groupCallInviteLoading, setGroupCallInviteLoading] = useState(false);
  const [groupCallInviteMembers, setGroupCallInviteMembers] = useState<GroupCallInviteMember[]>([]);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [threadSearchHits, setThreadSearchHits] = useState<
    { id: string; body: string; createdAt: string }[]
  >([]);
  const [threadSearchBusy, setThreadSearchBusy] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const nearBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
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
  const canPin = !isGroup || canAdminRecall;
  const list = messages[convId] ?? [];

  useEffect(() => {
    if (!isGroup || !convId) {
      setMentionMembers([]);
      setMyMuteUntil(undefined);
      setGroupMuteAll(false);
      return;
    }
    let cancelled = false;
    Promise.all([api<any>(`/v1/groups/${convId}`), api<any>("/v1/me")])
      .then(([g, me]) => {
        if (cancelled) return;
        const meId = String(me?.id ?? "");
        const raw = Array.isArray(g?.members) ? g.members : [];
        setMentionMembers(
          raw
            .filter((m: any) => String(m?.user_id ?? "") !== meId)
            .map((m: any) => ({
              userId: String(m?.user_id ?? ""),
              username: String(m?.username ?? ""),
              displayName: String(m?.display_name ?? m?.username ?? ""),
            }))
            .filter((m: MentionMember) => Boolean(m.username))
        );
        const self = raw.find((m: any) => String(m?.user_id ?? "") === meId);
        setMyMuteUntil(self?.mute_until ? String(self.mute_until) : undefined);
        setGroupMuteAll(Boolean(g?.mute_all));
      })
      .catch(() => {
        if (!cancelled) {
          setMentionMembers([]);
          setMyMuteUntil(undefined);
          setGroupMuteAll(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isGroup, convId]);

  useEffect(() => {
    if (!isGroup || !convId) return;
    return subscribeEvents((type, payload) => {
      if (type !== "group.updated") return;
      if (String(payload?.conversation_id ?? "") !== convId) return;
      if (payload?.mute_all != null) setGroupMuteAll(Boolean(payload.mute_all));
      const meId = user?.id;
      const members = Array.isArray(payload?.members) ? payload.members : null;
      if (meId && members) {
        const self = members.find((m: any) => String(m?.user_id ?? "") === meId);
        if (self) setMyMuteUntil(self?.mute_until ? String(self.mute_until) : undefined);
      }
    });
  }, [isGroup, convId, subscribeEvents, user?.id]);

  useEffect(() => {
    let cancelled = false;
    setText("");
    void getDraft(convId).then((draft) => {
      if (!cancelled && draft) setText(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [convId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void saveDraft(convId, editing ? "" : text);
    }, 250);
    return () => clearTimeout(timer);
  }, [convId, text, editing]);

  const isAdmin =
    isGroup && (conversation?.role === "owner" || conversation?.role === "admin");
  const speakMuted =
    Boolean(myMuteUntil) &&
    (myMuteUntil!.startsWith("9999") ||
      (!Number.isNaN(new Date(myMuteUntil!).getTime()) &&
        new Date(myMuteUntil!).getTime() > Date.now()));
  const muteAllActive = Boolean(conversation?.muteAll) || groupMuteAll;
  const composerBlockedByMute = isGroup && !isAdmin && (muteAllActive || speakMuted);
  const composerBlockedReason = composerBlockedByMute
    ? muteAllActive
      ? "The whole group is muted"
      : "You are muted in this group"
    : undefined;

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
    if (!threadSearchOpen) return;
    const q = threadSearchQuery.trim();
    if (q.length < 2) {
      setThreadSearchHits([]);
      setThreadSearchBusy(false);
      return;
    }
    let cancelled = false;
    setThreadSearchBusy(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, conversation_id: convId });
      api<any>(`/v1/search?${params}`)
        .then((body) => {
          if (cancelled) return;
          setThreadSearchHits(
            asList(body, "messages")
              .map((m: any) => ({
                id: String(m?.id ?? ""),
                body: String(m?.body ?? ""),
                createdAt: String(m?.created_at ?? ""),
              }))
              .filter((h: { id: string }) => h.id)
          );
        })
        .catch(() => {
          if (!cancelled) setThreadSearchHits([]);
        })
        .finally(() => {
          if (!cancelled) setThreadSearchBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [threadSearchOpen, threadSearchQuery, convId]);

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
    return () => {
      closeConversation(convId);
    };
  }, [convId, openConversation, closeConversation]);

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
    let subtitle = "";
    if (isDm && conversation?.peerId) {
      const presence = presenceByUser[conversation.peerId];
      const online = presence?.online ?? conversation.peerOnline;
      if (online) subtitle = "Online";
      else {
        subtitle = formatLastSeen(
          presence?.lastActiveAt || conversation.peerLastActiveAt
        );
      }
    } else if (conversation?.enterpriseName) {
      subtitle = conversation.enterpriseName;
    }
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
    const startDmCall = (kind: CallKind) => {
      if (callBusy || !conversation) return;
      call
        .startCall(conversation.id, kind, {
          peerName: conversationDisplayName(conversation),
        })
        .catch((e) => Alert.alert("Call failed", e?.message || "Could not start call"));
    };
    navigation.setOptions({
      headerShown: !selecting,
      title,
      headerTitleAlign: "left",
      headerTitle: () => (
        <Pressable onPress={openTitleTarget} hitSlop={6} style={{ maxWidth: 200 }}>
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
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{
                color: "rgba(255,255,255,0.75)",
                fontSize: 12,
                fontWeight: "500",
                marginTop: 1,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
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
          {isDm || isGroup ? (
            <>
              <Pressable
                onPress={() => {
                  if (callBusy || !conversation) return;
                  if (isGroup) {
                    setGroupCallInvite("voice");
                    return;
                  }
                  startDmCall("voice");
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
                  if (isGroup) {
                    setGroupCallInvite("video");
                    return;
                  }
                  startDmCall("video");
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
            onPress={() => {
              setThreadSearchOpen(true);
              setThreadSearchQuery("");
              setThreadSearchHits([]);
            }}
            hitSlop={10}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
            accessibilityLabel="Search in chat"
          >
            <Ionicons name="search-outline" size={22} color="#fff" />
          </Pressable>
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
    isGroup,
    call.active,
    call.incoming,
    call.startCall,
    presenceByUser,
    convId,
  ]);

  useEffect(() => {
    if (!groupCallInvite || !conversation || !isGroup) return;
    let cancelled = false;
    setGroupCallInviteLoading(true);
    loadGroupCallInviteMembers(conversation.id, [user?.id ?? ""].filter(Boolean))
      .then((members) => {
        if (!cancelled) setGroupCallInviteMembers(members);
      })
      .catch(() => {
        if (!cancelled) setGroupCallInviteMembers([]);
      })
      .finally(() => {
        if (!cancelled) setGroupCallInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupCallInvite, conversation, isGroup, user?.id]);

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

    if (
      contentOffset.y < 80 &&
      !loadingOlderRef.current &&
      hasMoreByConv[convId] !== false
    ) {
      loadingOlderRef.current = true;
      setLoadingOlder(true);
      void loadOlderMessages(convId).finally(() => {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      });
    }
  }, [convId, hasMoreByConv, loadOlderMessages]);

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

  const selectableIds = useMemo(
    () => list.filter((m) => !m.pending && !m.failed).map((m) => m.id),
    [list]
  );
  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = useCallback(() => {
    if (allSelectableSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(selectableIds);
  }, [allSelectableSelected, selectableIds]);

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
    if (composerBlockedByMute && !editing) {
      Alert.alert("Muted", composerBlockedReason || "You cannot send messages right now.");
      return;
    }
    setText("");
    void saveDraft(convId, "");
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
          onRetry={(m) => {
            void retryMessage(convId, m);
          }}
          onCancelUpload={(m) => cancelUpload(convId, m)}
          onReactChip={(m, emoji) => {
            void reactMessage(m.id, convId, emoji).catch(() => {});
          }}
          onOpenImage={setViewerUri}
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
              canPin={canPin}
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
          <Pressable
            style={styles.actionBtn}
            onPress={toggleSelectAll}
            hitSlop={8}
            disabled={selectableIds.length === 0}
            accessibilityLabel={allSelectableSelected ? "Deselect all" : "Select all"}
          >
            <Ionicons
              name={allSelectableSelected ? "checkbox" : "checkbox-outline"}
              size={22}
              color={selectableIds.length === 0 ? "rgba(255,255,255,0.35)" : "#fff"}
            />
          </Pressable>
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
              accessibilityLabel="Delete"
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
          loadingOlder={loadingOlder}
          historyComplete={hasMoreByConv[convId] === false && list.length > 0}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onPressMessage={onPressMessage}
          onLongPressMessage={onLongPressMessage}
          onPressReply={onPressReply}
          onRetry={(m) => {
            void retryMessage(convId, m);
          }}
          onCancelUpload={(m) => cancelUpload(convId, m)}
          onReactChip={(m, emoji) => {
            void reactMessage(m.id, convId, emoji).catch(() => {});
          }}
          onOpenImage={setViewerUri}
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
          onPickMedia={(uri, kind, name, mimeType, caption) => {
            if (composerBlockedByMute) return;
            sendMediaMessage(convId, uri, {
              kind,
              name,
              mimeType,
              replyToId: replyTo?.id,
              caption,
            }).catch(() => {});
            setReplyTo(null);
          }}
          onSendVoice={(uri, durationSec) => {
            if (composerBlockedByMute) return;
            sendVoiceMessage(convId, uri, durationSec, replyTo?.id).catch(() => {});
            setReplyTo(null);
          }}
          onSendRemoteImage={(url, caption) => {
            if (composerBlockedByMute) return;
            sendRemoteImage(convId, url, caption, replyTo?.id).catch(() => {});
            setReplyTo(null);
          }}
          onTyping={() => notifyTyping(convId)}
          typingPlaceholder={(() => {
            const typers = typingByConv[convId] ?? [];
            if (typers.length === 1) return `${typers[0].name} is typing…`;
            if (typers.length > 1) return `${typers.length} people typing…`;
            return undefined;
          })()}
          mentionEnabled={isGroup}
          mentionMembers={mentionMembers}
          disabled={composerBlockedByMute}
          disabledReason={composerBlockedReason}
        />
      ) : null}

      <Modal
        visible={Boolean(viewerUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <Pressable style={styles.imageViewerBg} onPress={() => setViewerUri(null)}>
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={styles.imageViewer} resizeMode="contain" />
          ) : null}
          <Pressable
            style={styles.imageViewerClose}
            onPress={() => setViewerUri(null)}
            accessibilityLabel="Close image"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {viewerUri ? (
            <Pressable
              style={styles.imageViewerSave}
              onPress={(e) => {
                e.stopPropagation?.();
                void (async () => {
                  const result = await saveChatMedia({
                    mediaUrl: viewerUri,
                    type: "image",
                  });
                  alertSaveResult(result);
                })();
              }}
              accessibilityLabel="Save image"
            >
              <Ionicons name="download-outline" size={26} color="#fff" />
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

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
            canPin={canPin}
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

      <Modal
        visible={threadSearchOpen}
        animationType="slide"
        onRequestClose={() => setThreadSearchOpen(false)}
      >
        <View style={[styles.threadSearchRoot, { paddingTop: insets.top + 8 }]}>
          <View style={styles.threadSearchBar}>
            <Ionicons name="search-outline" size={18} color="#9ca3af" />
            <TextInput
              style={styles.threadSearchInput}
              value={threadSearchQuery}
              onChangeText={setThreadSearchQuery}
              placeholder="Search in this chat"
              placeholderTextColor="#8e8e93"
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
            />
            <Pressable
              onPress={() => setThreadSearchOpen(false)}
              hitSlop={8}
              accessibilityLabel="Close search"
            >
              <Text style={styles.threadSearchClose}>Close</Text>
            </Pressable>
          </View>
          {threadSearchBusy ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              data={threadSearchHits}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              ListEmptyComponent={
                threadSearchQuery.trim().length >= 2 ? (
                  <Text style={styles.threadSearchEmpty}>No messages found</Text>
                ) : (
                  <Text style={styles.threadSearchEmpty}>Type at least 2 characters</Text>
                )
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.threadSearchHit}
                  onPress={() => {
                    setThreadSearchOpen(false);
                    requestAnimationFrame(() => {
                      jumpToMessageId(item.id, { missingTitle: "Search result" });
                    });
                  }}
                >
                  <Text style={styles.threadSearchHitBody} numberOfLines={3}>
                    {item.body || "(empty)"}
                  </Text>
                  {item.createdAt ? (
                    <Text style={styles.threadSearchHitMeta}>
                      {new Date(item.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  ) : null}
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>

      <GroupCallInviteSheet
        visible={Boolean(groupCallInvite) && isGroup}
        title={groupCallInvite === "video" ? "Start video call" : "Start voice call"}
        confirmLabel="Start"
        members={groupCallInviteMembers}
        loading={groupCallInviteLoading}
        busy={groupCallInviteBusy}
        onCancel={() => {
          if (!groupCallInviteBusy) setGroupCallInvite(null);
        }}
        onConfirm={(inviteeIds) => {
          if (!conversation || !groupCallInvite) return;
          void (async () => {
            setGroupCallInviteBusy(true);
            try {
              await call.startCall(conversation.id, groupCallInvite, {
                peerName: conversationDisplayName(conversation),
                inviteeIds,
              });
              setGroupCallInvite(null);
            } catch (e: any) {
              Alert.alert("Call failed", e?.message || "Could not start call");
            } finally {
              setGroupCallInviteBusy(false);
            }
          })();
        }}
      />
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
  mentionMine: { fontWeight: "700" as const, textDecorationLine: "underline" as const },
  mentionPeer: { fontWeight: "700" as const, color: c.accent },
  linkMine: { color: "#dbeafe", textDecorationLine: "underline" as const },
  linkPeer: { color: c.accent, textDecorationLine: "underline" as const },
  codeMine: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  codePeer: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  uploadRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 6,
  },
  uploadTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden" as const,
  },
  uploadFill: {
    height: 4,
    backgroundColor: "#fff",
  },
  imageViewerBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  imageViewer: { width: "100%" as const, height: "80%" as const },
  imageViewerClose: {
    position: "absolute" as const,
    top: 48,
    right: 20,
    padding: 8,
  },
  imageViewerSave: {
    position: "absolute" as const,
    top: 48,
    left: 20,
    padding: 8,
  },
  mediaRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minWidth: 140 },
  videoCol: { gap: 6, minWidth: 200, maxWidth: 260 },
  videoPlayer: {
    width: 240,
    height: 180,
    backgroundColor: "#000",
    borderRadius: 8,
  },
  imagePreview: {
    width: 240,
    height: 180,
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: 8,
  },
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
  threadSearchRoot: {
    flex: 1,
    backgroundColor: c.bg,
    paddingHorizontal: spacing.md,
  },
  threadSearchBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: c.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  threadSearchInput: {
    flex: 1,
    fontSize: 16,
    color: c.text,
    paddingVertical: 6,
  },
  threadSearchClose: {
    color: c.accent,
    fontWeight: "700" as const,
    fontSize: 15,
  },
  threadSearchEmpty: {
    textAlign: "center" as const,
    color: c.textMuted,
    paddingVertical: spacing.xl,
    fontSize: 14,
  },
  threadSearchHit: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  threadSearchHitBody: {
    fontSize: 15,
    color: c.text,
    lineHeight: 20,
  },
  threadSearchHitMeta: {
    marginTop: 4,
    fontSize: 12,
    color: c.textMuted,
  },
};
}
