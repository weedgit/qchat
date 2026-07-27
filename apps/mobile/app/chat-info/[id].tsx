/**
 * Chat details — DM profile / group info (channel info RHS parity).
 * Owner/admin: Add members via POST /v1/groups/{id}/members.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Avatar } from "../../src/components/Avatar";
import { GroupQr } from "../../src/components/GroupQr";
import { useAuth } from "../../src/context/AuthContext";
import { useChat } from "../../src/context/ChatContext";
import { api, asList } from "../../src/lib/api";
import { encodeGroupJoinPayload } from "../../src/lib/groupQr";
import {
  Friend,
  conversationDisplayName,
  normalizeFriend,
} from "../../src/lib/types";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../../src/theme";

type GroupMember = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  role: string;
  muteUntil?: string;
};

type PendingUser = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
};

type GroupDetails = {
  id: string;
  title: string;
  description: string;
  announcement: string;
  publicId: string;
  avatarUrl?: string;
  muteAll: boolean;
  forbidMemberFriendAdd: boolean;
  role: string;
  ownerId: string;
  members: GroupMember[];
};

function formatLastSeen(iso?: string): string {
  if (!iso) return "Offline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Offline";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return "Last seen just now";
  if (sec < 3600) return `Last seen ${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `Last seen ${Math.floor(sec / 3600)}h ago`;
  return `Last seen ${d.toLocaleString()}`;
}

function formatMuteLabel(muteUntil?: string): string {
  if (!muteUntil) return "";
  const d = new Date(muteUntil);
  if (Number.isNaN(d.getTime())) return "muted";
  if (d.getFullYear() >= 9999) return "muted permanently";
  return `muted until ${d.toLocaleString()}`;
}

export default function ChatInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = String(id);
  const { conversations, updateConversationPrefs, loadConversations, leaveGroup, subscribeEvents } =
    useChat();
  const { user: me } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const conversation = useMemo(
    () => conversations.find((c) => c.id === convId) ?? null,
    [conversations, convId]
  );

  const isDm = conversation?.type === "dm";
  const isGroup = conversation?.type === "social_group" || conversation?.type === "group";

  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [friendQuery, setFriendQuery] = useState("");

  const canManageGroup = group?.role === "owner" || group?.role === "admin";
  const isOwner = group?.role === "owner";

  const loadGroup = useCallback(async () => {
    if (!isGroup) return;
    setError(null);
    try {
      const g = await api<any>(`/v1/groups/${convId}`);
      const members = (Array.isArray(g?.members) ? g.members : []).map((m: any) => ({
        userId: String(m?.user_id ?? ""),
        username: String(m?.username ?? ""),
        displayName: String(m?.display_name ?? m?.username ?? "Member"),
        avatarUrl: m?.avatar_url || undefined,
        role: String(m?.role ?? "member"),
        muteUntil: m?.mute_until ? String(m.mute_until) : undefined,
      }));
      const role = String(g?.role ?? "member");
      setGroup({
        id: String(g?.id ?? convId),
        title: String(g?.title ?? ""),
        description: String(g?.description ?? ""),
        announcement: String(g?.announcement ?? ""),
        publicId: String(g?.public_id ?? ""),
        avatarUrl: g?.avatar_url || undefined,
        muteAll: Boolean(g?.mute_all),
        forbidMemberFriendAdd: Boolean(g?.forbid_member_friend_add),
        role,
        ownerId: String(g?.owner_id ?? ""),
        members,
      });
      if (role === "owner" || role === "admin") {
        try {
          const pend = await api<any>(`/v1/groups/${convId}/pending`);
          setPending(
            asList(pend, "pending").map((p: any) => ({
              userId: String(p?.user_id ?? p?.id ?? ""),
              username: String(p?.username ?? ""),
              displayName: String(p?.display_name ?? p?.nickname ?? p?.username ?? "User"),
              avatarUrl: p?.avatar_url || undefined,
            })).filter((p: PendingUser) => p.userId)
          );
        } catch {
          setPending([]);
        }
      } else {
        setPending([]);
      }
    } catch (e: any) {
      setError(e?.message || "Could not load group");
    }
  }, [convId, isGroup]);

  useEffect(() => {
    if (conversation) {
      setNote(conversation.friendNote || "");
      setTagsText((conversation.friendTags || []).join(", "));
    }
  }, [conversation]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    if (!isGroup || !canManageGroup) return;
    return subscribeEvents((type, payload) => {
      if (type !== "group.join_request" && type !== "group.pending_changed") return;
      const id = String(payload?.conversation_id ?? "");
      if (id !== convId) return;
      void loadGroup();
    });
  }, [isGroup, canManageGroup, convId, subscribeEvents, loadGroup]);

  useEffect(() => {
    if (!isGroup) return;
    return subscribeEvents((type, payload) => {
      if (type !== "group.updated") return;
      const id = String(payload?.conversation_id ?? "");
      if (id !== convId) return;
      if (Array.isArray(payload?.added_member_ids)) {
        void loadGroup();
      }
    });
  }, [isGroup, convId, subscribeEvents, loadGroup]);

  async function toggleMute() {
    if (!conversation) return;
    setBusy(true);
    try {
      await updateConversationPrefs(convId, { muted: !conversation.muted });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not update mute");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite() {
    if (!conversation) return;
    setBusy(true);
    try {
      await updateConversationPrefs(convId, { favorite: !conversation.favorite });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not update favorite");
    } finally {
      setBusy(false);
    }
  }

  /** Speak-mute (not notification mute): POST /v1/groups/{id}/mute */
  async function muteMember(userId: string, duration: string) {
    setBusy(true);
    try {
      await api(`/v1/groups/${convId}/mute`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, duration }),
      });
      await loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not update mute");
    } finally {
      setBusy(false);
    }
  }

  function openMuteDurations(m: GroupMember) {
    const buttons: {
      text: string;
      style?: "cancel" | "destructive" | "default";
      onPress?: () => void;
    }[] = [
      { text: "Mute 10 minutes", onPress: () => muteMember(m.userId, "10m") },
      { text: "Mute 1 hour", onPress: () => muteMember(m.userId, "1h") },
      { text: "Mute permanently", onPress: () => muteMember(m.userId, "permanent") },
    ];
    if (m.muteUntil) {
      buttons.push({
        text: "Unmute",
        onPress: () => muteMember(m.userId, "off"),
      });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(
      `Mute ${m.displayName}`,
      m.muteUntil ? formatMuteLabel(m.muteUntil) : "Choose how long they cannot send messages.",
      buttons
    );
  }

  async function saveFriendNote() {
    if (!conversation?.friendshipId) return;
    setBusy(true);
    try {
      const tags = tagsText
        .split(/[,#\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await api(`/v1/friends/${conversation.friendshipId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: note.trim(), tags }),
      });
      await loadConversations();
      Alert.alert("Saved", "Friend note updated.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save note");
    } finally {
      setBusy(false);
    }
  }

  async function openAddMembers() {
    setPicked(new Set());
    setFriendQuery("");
    setBusy(true);
    try {
      const body = await api<any>("/v1/friends");
      const list = asList(body, "friends", "users")
        .map(normalizeFriend)
        .filter((f) => f.status === "accepted");
      setFriends(list);
      setAddOpen(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load friends");
    } finally {
      setBusy(false);
    }
  }

  const memberIds = useMemo(
    () => new Set((group?.members || []).map((m) => m.userId)),
    [group]
  );

  const addableFriends = useMemo(() => {
    const q = friendQuery.trim().toLowerCase();
    return friends.filter((f) => {
      if (memberIds.has(f.userId)) return false;
      if (!q) return true;
      const name = (f.note || f.nickname || f.username).toLowerCase();
      return name.includes(q) || f.username.toLowerCase().includes(q);
    });
  }, [friends, memberIds, friendQuery]);

  function togglePick(userId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function confirmAddMembers() {
    if (picked.size === 0) {
      setAddOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await api<any>(`/v1/groups/${convId}/members`, {
        method: "POST",
        body: JSON.stringify({ member_ids: [...picked] }),
      });
      const added = Array.isArray(res?.added) ? res.added.length : 0;
      setAddOpen(false);
      await loadGroup();
      Alert.alert("Members", added ? `Added ${added} member(s).` : "No new members added.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not add members");
    } finally {
      setBusy(false);
    }
  }

  async function shareInvite() {
    if (!group?.publicId) return;
    const payload = encodeGroupJoinPayload(group.publicId);
    try {
      await Share.share({
        message: `Join my Qchat group with invite ${group.publicId}\n${payload}`,
      });
    } catch {
      /* user dismissed */
    }
  }

  async function approvePending(userId: string) {
    setBusy(true);
    try {
      await api(`/v1/groups/${convId}/approve`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
      await loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not approve");
    } finally {
      setBusy(false);
    }
  }

  function confirmLeaveGroup() {
    Alert.alert("Leave group", "Leave this group?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          leaveGroup(convId)
            .then(() => {
              router.replace("/(tabs)/chats");
            })
            .catch((e: any) => Alert.alert("Error", e?.message || "Could not leave group"))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

 /** Owner/admin: role, speak-mute, kick (channel member menu). */
  function onMemberLongPress(m: GroupMember) {
    if (m.userId === me?.id || m.role === "owner") return;
    const buttons: {
      text: string;
      style?: "cancel" | "destructive" | "default";
      onPress?: () => void;
    }[] = [];
    if (isOwner && (m.role === "member" || m.role === "admin")) {
      const makeAdmin = m.role !== "admin";
      buttons.push({
        text: makeAdmin ? "Promote to admin" : "Remove admin role",
        onPress: () => {
          setBusy(true);
          api(`/v1/groups/${convId}/admins`, {
            method: "POST",
            body: JSON.stringify({
              user_id: m.userId,
              role: makeAdmin ? "admin" : "member",
            }),
          })
            .then(() => loadGroup())
            .catch((e: any) => Alert.alert("Error", e?.message || "Could not update role"))
            .finally(() => setBusy(false));
        },
      });
    }
    const canMute =
      canManageGroup &&
      !(group?.role === "admin" && m.role === "admin");
    if (canMute) {
      buttons.push({
        text: m.muteUntil ? "Mute / unmute…" : "Mute speaking…",
        onPress: () => openMuteDurations(m),
      });
    }
    const canRemove =
      canManageGroup &&
      !(group?.role === "admin" && m.role === "admin");
    if (canRemove) {
      buttons.push({
        text: "Remove from group",
        style: "destructive",
        onPress: () => {
          Alert.alert("Remove member", `Remove ${m.displayName} from this group?`, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => {
                setBusy(true);
                api(`/v1/groups/${convId}/members/${m.userId}`, { method: "DELETE" })
                  .then(() => loadGroup())
                  .catch((e: any) => Alert.alert("Error", e?.message || "Could not remove"))
                  .finally(() => setBusy(false));
              },
            },
          ]);
        },
      });
    }
    if (buttons.length === 0) return;
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(m.displayName, `@${m.username} · ${m.role}`, buttons);
  }

  const title = conversation
    ? isGroup
      ? group?.title || conversationDisplayName(conversation)
      : conversationDisplayName(conversation)
    : "Chat info";

  return (
    <>
      <Stack.Screen options={{ title: isDm ? "Chat info" : "Group info" }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!conversation ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.hero}>
              <Pressable
                onPress={() => {
                  if (isDm && conversation.peerId) {
                    router.push({ pathname: "/user/[id]", params: { id: conversation.peerId } });
                  }
                }}
                disabled={!isDm || !conversation.peerId}
                style={{ alignItems: "center", gap: spacing.sm }}
              >
                <Avatar
                  name={title}
                  url={group?.avatarUrl || conversation.avatarUrl}
                  size={88}
                />
                <Text style={styles.name}>{title}</Text>
              </Pressable>
              {isDm && conversation.friendNote ? (
                <Text style={styles.sub}>{conversation.title}</Text>
              ) : null}
              {isDm ? (
                <Text style={styles.sub}>
                  {conversation.peerOnline
                    ? "Online"
                    : formatLastSeen(conversation.peerLastActiveAt)}
                </Text>
              ) : (
                <Text style={styles.sub}>
                  {group?.members.length ?? 0} members
                  {group?.role ? ` · You are ${group.role}` : ""}
                </Text>
              )}
              {isDm && conversation.friendTags && conversation.friendTags.length > 0 ? (
                <View style={styles.tagRow}>
                  {conversation.friendTags.map((t) => (
                    <Text key={t} style={styles.tag}>
                      #{t}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            {isGroup && canManageGroup ? (
              <Pressable style={styles.addMembersBtn} onPress={openAddMembers} disabled={busy}>
                <Ionicons name="person-add-outline" size={20} color="#fff" />
                <Text style={styles.addMembersText}>Add members</Text>
              </Pressable>
            ) : null}

            <View style={styles.card}>
              <ToggleRow
                label="Mute notifications"
                value={Boolean(conversation.muted)}
                onValueChange={() => toggleMute()}
                disabled={busy}
              />
              <ToggleRow
                label="Favorite"
                value={Boolean(conversation.favorite)}
                onValueChange={() => toggleFavorite()}
                disabled={busy}
              />
            </View>

            {isDm && conversation.friendshipId ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Friend note</Text>
                <Text style={styles.label}>Note (shown as chat name)</Text>
                <TextInput
                  style={styles.input}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Alias"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.label}>Tags (comma-separated)</Text>
                <TextInput
                  style={styles.input}
                  value={tagsText}
                  onChangeText={setTagsText}
                  placeholder="work, family"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                <Pressable style={styles.primaryBtn} onPress={saveFriendNote} disabled={busy}>
                  <Text style={styles.primaryBtnText}>Save note</Text>
                </Pressable>
              </View>
            ) : null}

            {isGroup && group ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Invite</Text>
                  {group.publicId ? <GroupQr publicId={group.publicId} /> : null}
                  <InfoLine label="Invite ID" value={group.publicId || "—"} />
                  <Pressable
                    style={styles.primaryBtn}
                    onPress={shareInvite}
                    disabled={!group.publicId || busy}
                  >
                    <Text style={styles.primaryBtnText}>Share invite</Text>
                  </Pressable>
                  {group.description ? (
                    <InfoLine label="Description" value={group.description} />
                  ) : null}
                  {group.announcement ? (
                    <InfoLine label="Announcement" value={group.announcement} />
                  ) : null}
                  {group.muteAll ? (
                    <Text style={styles.warn}>Mute all is on — only owners/admins can send</Text>
                  ) : null}
                  {canManageGroup ? (
                    <Pressable
                      style={[styles.primaryBtn, group.muteAll ? styles.secondaryBtn : null]}
                      onPress={() => muteMember("", group.muteAll ? "all_off" : "all")}
                      disabled={busy}
                    >
                      <Text
                        style={[
                          styles.primaryBtnText,
                          group.muteAll ? styles.secondaryBtnText : null,
                        ]}
                      >
                        {group.muteAll ? "Unmute whole group" : "Mute whole group"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {canManageGroup ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Pending requests</Text>
                    {pending.length === 0 ? (
                      <Text style={styles.emptyInline}>No pending join requests.</Text>
                    ) : (
                      pending.map((p) => (
                        <View key={p.userId} style={styles.memberRow}>
                          <Avatar name={p.displayName} url={p.avatarUrl} size={40} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.memberName} numberOfLines={1}>
                              {p.displayName}
                            </Text>
                            <Text style={styles.memberMeta}>
                              @{p.username || "user"}
                            </Text>
                          </View>
                          <Pressable
                            style={styles.approveBtn}
                            onPress={() => approvePending(p.userId)}
                            disabled={busy}
                          >
                            <Text style={styles.approveBtnText}>Approve</Text>
                          </Pressable>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}

                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardTitle}>Members</Text>
                    {canManageGroup ? (
                      <Pressable onPress={openAddMembers} hitSlop={8}>
                        <Text style={styles.link}>Add</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {group.members.map((m) => {
                    const isMe = m.userId === me?.id;
                    return (
                      <Pressable
                        key={m.userId}
                        style={styles.memberRow}
                        disabled={isMe}
                        onPress={() => {
                          if (isMe) return;
                          router.push({ pathname: "/user/[id]", params: { id: m.userId } });
                        }}
                        onLongPress={() => onMemberLongPress(m)}
                        delayLongPress={350}
                      >
                        <Avatar name={m.displayName} url={m.avatarUrl} size={40} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.memberNameRow}>
                            <Text style={styles.memberName} numberOfLines={1}>
                              {m.displayName}
                            </Text>
                            {isMe ? <Text style={styles.meBadge}>me</Text> : null}
                          </View>
                          <Text style={styles.memberMeta}>
                            @{m.username}
                            {m.role !== "member" ? ` · ${m.role}` : ""}
                            {m.muteUntil ? ` · ${formatMuteLabel(m.muteUntil)}` : ""}
                          </Text>
                        </View>
                        {!isMe ? (
                          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {isGroup && group && !isOwner ? (
              <Pressable
                style={styles.leaveBtn}
                onPress={confirmLeaveGroup}
                disabled={busy}
              >
                <Text style={styles.leaveBtnText}>Leave group</Text>
              </Pressable>
            ) : null}

            <View style={styles.card}>
              <InfoLine label="Type" value={conversation.type} />
              <InfoLine label="Conversation ID" value={conversation.id} />
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setAddOpen(false)} hitSlop={8}>
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Add members</Text>
            <Pressable onPress={confirmAddMembers} disabled={busy || picked.size === 0} hitSlop={8}>
              <Text style={[styles.link, picked.size === 0 && { opacity: 0.4 }]}>
                Add{picked.size ? ` (${picked.size})` : ""}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.search}
            placeholder="Search friends"
            placeholderTextColor={colors.textMuted}
            value={friendQuery}
            onChangeText={setFriendQuery}
            autoCapitalize="none"
          />
          <FlatList
            data={addableFriends}
            keyExtractor={(f) => f.userId}
            ListEmptyComponent={
              <Text style={styles.empty}>No friends left to add.</Text>
            }
            renderItem={({ item: f }) => {
              const selected = picked.has(f.userId);
              const name = f.note || f.nickname || f.username;
              return (
                <Pressable style={styles.pickRow} onPress={() => togglePick(f.userId)}>
                  <Avatar name={name} url={f.avatarUrl} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{name}</Text>
                    <Text style={styles.memberMeta}>@{f.username}</Text>
                  </View>
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={selected ? colors.accent : colors.textMuted}
                  />
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={() => onValueChange()}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.infoLine}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function makeStyles(c: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: c.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
  error: { color: c.danger, padding: spacing.sm },
  hero: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
  name: { fontSize: 20, fontWeight: "700" as const, color: c.text, textAlign: "center" as const },
  sub: { fontSize: 13, color: c.textSecondary, textAlign: "center" as const },
  tagRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, justifyContent: "center" as const },
  tag: {
    backgroundColor: c.inputBg,
    color: c.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    fontSize: 12,
    overflow: "hidden" as const,
  },
  addMembersBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: c.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  addMembersText: { color: "#fff", fontWeight: "700" as const, fontSize: 16 },
  leaveBtn: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center" as const,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.danger,
  },
  leaveBtnText: { color: c.danger, fontWeight: "700" as const, fontSize: 16 },
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  cardTitle: { fontSize: 16, fontWeight: "700" as const, color: c.text },
  label: { color: c.textSecondary, fontSize: 12, fontWeight: "500" as const },
  input: {
    backgroundColor: c.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: c.text,
  },
  primaryBtn: {
    backgroundColor: c.accent,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center" as const,
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" as const },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  secondaryBtnText: { color: c.text },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 4,
  },
  toggleLabel: { color: c.text, fontSize: 15 },
  infoLine: { gap: 2 },
  infoValue: { color: c.text, fontSize: 14 },
  warn: { color: c.danger, fontSize: 13 },
  memberRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  memberName: { fontSize: 15, fontWeight: "600" as const, color: c.text, flexShrink: 1 },
  memberNameRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  meBadge: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: c.accent,
    backgroundColor: "rgba(36,99,220,0.12)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: "hidden" as const,
  },
  memberMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  link: { color: c.accent, fontWeight: "600" as const, fontSize: 15 },
  modalRoot: { flex: 1, backgroundColor: c.bg, paddingTop: 56 },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  modalTitle: { fontSize: 17, fontWeight: "700" as const, color: c.text },
  search: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: c.text,
  },
  pickRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  empty: {
    textAlign: "center" as const,
    color: c.textSecondary,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  emptyInline: {
    color: c.textSecondary,
    fontSize: 13,
    paddingVertical: 4,
  },
  approveBtn: {
    backgroundColor: c.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  approveBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 13 },
};
}
