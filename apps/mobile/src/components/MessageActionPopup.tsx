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

type ActionKey = "reply" | "copy" | "forward" | "pin" | "unpin" | "edit" | "delete" | "select";

export type MessageActionPopupProps = {
  msg: Message;
  pinned: boolean;
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
  onClose,
  onReact,
  onAction,
}: MessageActionPopupProps) {
  const title = msg.mine
    ? statusLabel(msg)
    : msg.senderName || "User";
  const canReact = !msg.recalled && !msg.pending && !msg.failed;
  const canReply = canReact;
  const canCopy = !msg.recalled && Boolean((msg.content || "").trim() || msg.mediaUrl);
  const canForward = !msg.recalled && !msg.pending && !msg.failed;
  const canPin = canForward;
  const canEdit = Boolean(msg.mine && !msg.recalled && !msg.pending && !msg.failed && msg.type !== "voice");
  const canDelete = Boolean(msg.mine && !msg.recalled && !msg.pending && !msg.failed);

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

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        {canReact ? (
          <View style={styles.reactBar}>
            {QUICK_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                style={styles.reactBtn}
                onPress={() => onReact(emoji)}
                hitSlop={4}
              >
                <Text style={styles.reactEmoji}>{emoji}</Text>
              </Pressable>
            ))}
            <View style={styles.reactMore}>
              <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.7)" />
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
  reactBar: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#2c2c2e",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  reactBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  reactEmoji: { fontSize: 22 },
  reactMore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
  menu: {
    backgroundColor: "#2c2c2e",
    borderRadius: 16,
    overflow: "hidden",
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
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
    fontSize: 16,
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
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  menuRowLast: { borderBottomWidth: 0 },
  menuLabel: { color: "#fff", fontSize: 16, fontWeight: "500" },
  menuLabelDanger: { color: "#ff6b6b" },
});
