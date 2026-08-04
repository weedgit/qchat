/**
 * Pick group members to invite into a voice/video call (mirrors web GroupCallInviteModal).
 * Wire from chat header (start) or CallOverlay (mid-call invite).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./Avatar";
import { useTheme, useThemedStyles } from "../context/ThemeContext";
import { api } from "../lib/api";
import { spacing, type ColorTokens } from "../theme";

export type GroupCallInviteMember = {
  userId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
};

/** Load group members and drop excluded ids (self, already-in-call peers). */
export async function loadGroupCallInviteMembers(
  conversationId: string,
  excludeIds?: string[]
): Promise<GroupCallInviteMember[]> {
  const g = await api<any>(`/v1/groups/${conversationId}`);
  const exclude = new Set((excludeIds ?? []).filter(Boolean));
  const raw = Array.isArray(g?.members) ? g.members : [];
  return raw
    .map((m: any) => ({
      userId: String(m?.user_id ?? ""),
      displayName: String(m?.display_name ?? m?.username ?? "Member"),
      username: String(m?.username ?? "") || undefined,
      avatarUrl: m?.avatar_url || undefined,
    }))
    .filter((m: GroupCallInviteMember) => Boolean(m.userId) && !exclude.has(m.userId));
}

export type GroupCallInviteSheetProps = {
  visible: boolean;
  title: string;
  confirmLabel: string;
  members: GroupCallInviteMember[];
  /** Extra exclusions beyond members already filtered (e.g. self). */
  excludeIds?: string[];
  busy?: boolean;
  loading?: boolean;
  onConfirm: (inviteeIds: string[]) => void;
  onCancel: () => void;
};

/** Member multi-select sheet → returns invitee_ids on confirm. */
export function GroupCallInviteSheet({
  visible,
  title,
  confirmLabel,
  members,
  excludeIds,
  busy,
  loading,
  onConfirm,
  onCancel,
}: GroupCallInviteSheetProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const exclude = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const candidates = useMemo(
    () => members.filter((m) => m.userId && !exclude.has(m.userId)),
    [members, exclude]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setQuery("");
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        (m.username ?? "").toLowerCase().includes(q)
    );
  }, [candidates, query]);

  function toggle(id: string) {
    if (busy) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!busy) onCancel();
      }}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (!busy) onCancel();
            }}
            hitSlop={8}
            disabled={busy}
          >
            <Text style={[styles.link, busy && styles.disabled]}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={() => onConfirm(Array.from(selected))}
            hitSlop={8}
            disabled={busy || selected.size === 0}
          >
            <Text
              style={[
                styles.link,
                (busy || selected.size === 0) && styles.disabled,
              ]}
            >
              {confirmLabel}
              {selected.size > 0 ? ` (${selected.size})` : ""}
            </Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search members"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(m) => m.userId}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>No members available to invite.</Text>
            }
            renderItem={({ item: m }) => {
              const on = selected.has(m.userId);
              return (
                <Pressable
                  style={[styles.row, on && styles.rowSelected]}
                  onPress={() => toggle(m.userId)}
                  disabled={busy}
                >
                  <Avatar name={m.displayName} url={m.avatarUrl} size={40} />
                  <View style={styles.meta}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.displayName}
                    </Text>
                    {m.username ? (
                      <Text style={styles.username} numberOfLines={1}>
                        @{m.username}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={on ? colors.accent : colors.textMuted}
                  />
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

function makeStyles(c: ColorTokens) {
  return {
    root: {
      flex: 1,
      backgroundColor: c.bg,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surface,
      gap: spacing.sm,
    },
    title: {
      flex: 1,
      textAlign: "center" as const,
      color: c.text,
      fontSize: 16,
      fontWeight: "600" as const,
    },
    link: {
      color: c.accent,
      fontSize: 16,
      fontWeight: "600" as const,
      minWidth: 64,
    },
    disabled: {
      opacity: 0.4,
    },
    search: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: c.inputBg,
      color: c.text,
      fontSize: 15,
    },
    centered: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    empty: {
      textAlign: "center" as const,
      color: c.textMuted,
      marginTop: spacing.xxl,
      paddingHorizontal: spacing.xl,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowSelected: {
      backgroundColor: c.surface,
    },
    meta: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      color: c.text,
      fontSize: 16,
      fontWeight: "600" as const,
    },
    username: {
      color: c.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
  };
}
