import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./Avatar";
import { Message } from "../lib/types";

/** Mirror web QUICK_EMOJIS / Telegram reaction strip. */
export const QUICK_EMOJIS = [
  "\u2764\ufe0f", // ❤️
  "\u{1F44D}", // 👍
  "\u{1F44E}", // 👎
  "\u{1F525}", // 🔥
  "\u{1F970}", // 🥰
  "\u{1F44F}", // 👏
  "\u{1F603}", // 😃
] as const;

const MORE_EMOJIS = [
  "\u{1F602}", // 😂
  "\u{1F62E}", // 😮
  "\u{1F622}", // 😢
  "\u{1F621}", // 😡
  "\u{1F64F}", // 🙏
  "\u{1F389}", // 🎉
  "\u{1F4AF}", // 💯
  "\u2B50", // ⭐
  "\u{1F44C}", // 👌
  "\u{1F91D}", // 🤝
  "\u{1F480}", // 💀
  "\u{1F923}", // 🤣
] as const;

type ActionKey = "reply" | "copy" | "forward" | "pin" | "unpin" | "edit" | "delete" | "select";

export type MessageActionPopupProps = {
  msg: Message;
  pinned: boolean;
  /** Group owner/admin may delete (recall) others' messages. */
  canAdminRecall?: boolean;
  /** Groups reserve the pinned message for owner/admin; DM participants may pin. */
  canPin?: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onAction: (action: ActionKey) => void;
};

function statusLabel(msg: Message): string {
  if (msg.pending) return "Sending";
  if (msg.failed) return "Failed";
  if (msg.read) return "Read";
  if (msg.delivered) return "Delivered";
  return "Sent";
}

/**
 * Telegram-style single-message popup: reaction pill + action card.
 * Mobile-only UI (web keeps its right-click menu).
 */
export function MessageActionPopup({
  msg,
  pinned,
  canAdminRecall,
  canPin: canPinConversation = true,
  onClose,
  onReact,
  onAction,
}: MessageActionPopupProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const title = msg.mine
    ? statusLabel(msg)
    : msg.senderName || "User";
  const canReact = !msg.recalled && !msg.pending && !msg.failed;
  const canReply = canReact;
  const canCopy = !msg.recalled && Boolean((msg.content || "").trim() || msg.mediaUrl);
  const canForward = !msg.recalled && !msg.pending && !msg.failed;
  const canPin = canForward && canPinConversation;
  const canEdit = Boolean(msg.mine && !msg.recalled && !msg.pending && !msg.failed && msg.type !== "voice" && msg.type !== "call");
  const canDelete = Boolean(
    !msg.recalled &&
      !msg.pending &&
      !msg.failed &&
      (msg.mine || canAdminRecall)
  );

  const rows: { key: ActionKey; label: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean }[] = [];
  if (canReply) rows.push({ key: "reply", label: "Reply", icon: "arrow-undo-outline" });
  if (canCopy) rows.push({ key: "copy", label: "Copy", icon: "copy-outline" });
  if (canForward) rows.push({ key: "forward", label: "Forward", icon: "arrow-redo-outline" });
  if (canPin) {
    rows.push(
      pinned
        ? { key: "unpin", label: "Unpin", icon: "pin-outline" }
        : { key: "pin", label: "Pin", icon: "pin" }
    );
  }
  if (canEdit) rows.push({ key: "edit", label: "Edit", icon: "pencil-outline" });
  if (canDelete) rows.push({ key: "delete", label: "Delete", icon: "trash-outline", danger: true });
  rows.push({ key: "select", label: "Select", icon: "checkbox-outline" });

  const reactList = moreOpen ? [...QUICK_EMOJIS, ...MORE_EMOJIS] : [...QUICK_EMOJIS];

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        {canReact ? (
          <View style={styles.reactWrap}>
            <View style={[styles.reactBar, moreOpen && styles.reactBarExpanded]}>
              {reactList.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.reactBtn}
                  onPress={() => onReact(emoji)}
                  hitSlop={4}
                >
                  <Text style={styles.reactEmoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                style={styles.reactMore}
                onPress={() => setMoreOpen((v) => !v)}
                accessibilityLabel={moreOpen ? "Fewer reactions" : "More reactions"}
                hitSlop={4}
              >
                <Ionicons
                  name={moreOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="rgba(255,255,255,0.7)"
                />
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.menu}>
          <View style={styles.menuHeader}>
            <View style={styles.menuHeaderLeft}>
              {msg.mine ? (
                <Ionicons
                  name={msg.read ? "checkmark-done" : "checkmark"}
                  size={18}
                  color="#6eb3f7"
                />
              ) : null}
              <Text style={styles.menuTitle} numberOfLines={1}>
                {title}
              </Text>
            </View>
            <Avatar
              name={msg.mine ? title : msg.senderName || "?"}
              url={msg.senderAvatar}
              size={28}
            />
          </View>

          {rows.map((row, i) => (
            <Pressable
              key={row.key}
              style={[styles.menuRow, i === rows.length - 1 && styles.menuRowLast]}
              onPress={() => onAction(row.key)}
            >
              <Ionicons
                name={row.icon}
                size={22}
                color={row.danger ? "#ff6b6b" : "#fff"}
              />
              <Text style={[styles.menuLabel, row.danger && styles.menuLabelDanger]}>
                {row.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  sheet: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 320,
    gap: 10,
  },
  reactWrap: {
    alignItems: "center",
  },
  reactBar: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    flexWrap: "nowrap",
    backgroundColor: "#2c2c2e",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  reactBarExpanded: {
    flexWrap: "wrap",
    maxWidth: 320,
    justifyContent: "center",
    borderRadius: 18,
  },
  reactBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  reactEmoji: {
    fontSize: 22,
  },
  reactMore: {
    width: 28,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    backgroundColor: "#2c2c2e",
    borderRadius: 14,
    overflow: "hidden",
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3c",
  },
  menuHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  menuTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3c",
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
  menuLabelDanger: {
    color: "#ff6b6b",
  },
});
