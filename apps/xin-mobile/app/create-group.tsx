/**
 * Create a social group: title + optional member invites (friends or exact username lookup).
 * Mirrors web Groups modal POST /v1/groups.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { Avatar } from "../src/components/Avatar";
import { useChat } from "../src/context/ChatContext";
import { useTheme, useThemedStyles } from "../src/context/ThemeContext";
import { api, asList } from "../src/lib/api";
import { Friend, normalizeFriend } from "../src/lib/types";
import { radius, spacing, type ColorTokens } from "../src/theme";

type InviteCandidate = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isFriend: boolean;
};

export default function CreateGroupScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { loadConversations } = useChat();
  const [title, setTitle] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [lookupHits, setLookupHits] = useState<InviteCandidate[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedProfiles, setPickedProfiles] = useState<Record<string, InviteCandidate>>({});
  const [query, setQuery] = useState("");
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadFriends = useCallback(async () => {
    setLoadingFriends(true);
    try {
      const body = await api<any>("/v1/friends");
      setFriends(
        asList(body, "friends", "users")
          .map(normalizeFriend)
          .filter((f) => f.status === "accepted")
      );
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load friends");
      setFriends([]);
    } finally {
      setLoadingFriends(false);
    }
  }, []);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setLookupHits([]);
      setLookupBusy(false);
      return;
    }
    let cancelled = false;
    setLookupBusy(true);
    const timer = setTimeout(() => {
      api<any>(`/v1/users/lookup?q=${encodeURIComponent(q)}`)
        .then((body) => {
          if (cancelled) return;
          setLookupHits(
            asList(body, "users")
              .map((u: any) => ({
                userId: String(u?.id ?? ""),
                username: String(u?.username ?? ""),
                displayName: String(u?.display_name ?? u?.username ?? ""),
                avatarUrl: u?.avatar_url || undefined,
                isFriend: false,
              }))
              .filter((u: InviteCandidate) => u.userId)
          );
        })
        .catch(() => {
          if (!cancelled) setLookupHits([]);
        })
        .finally(() => {
          if (!cancelled) setLookupBusy(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pickedSet = new Set(picked);
    const selectedRows = picked
      .map((id) => pickedProfiles[id])
      .filter(Boolean) as InviteCandidate[];
    const friendRows: InviteCandidate[] = friends
      .filter((f) => {
        if (pickedSet.has(f.userId)) return false;
        if (!q) return true;
        const name = (f.note || f.nickname || f.username).toLowerCase();
        return name.includes(q) || f.username.toLowerCase().includes(q);
      })
      .map((f) => ({
        userId: f.userId,
        username: f.username,
        displayName: f.note || f.nickname || f.username,
        avatarUrl: f.avatarUrl,
        isFriend: true,
      }));
    const friendIds = new Set(friends.map((f) => f.userId));
    const extra = lookupHits.filter((u) => !friendIds.has(u.userId) && !pickedSet.has(u.userId));
    return [...friendRows, ...extra, ...selectedRows];
  }, [friends, query, lookupHits, picked, pickedProfiles]);

  function togglePick(user: InviteCandidate) {
    setPicked((prev) =>
      prev.includes(user.userId)
        ? prev.filter((id) => id !== user.userId)
        : [user.userId, ...prev]
    );
    setPickedProfiles((prev) => {
      if (prev[user.userId]) {
        const next = { ...prev };
        delete next[user.userId];
        return next;
      }
      return { ...prev, [user.userId]: user };
    });
  }

  async function create() {
    const name = title.trim();
    if (!name) {
      Alert.alert("Create group", "Enter a group name.");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title: name };
      if (picked.length > 0) body.member_ids = picked;
      const res = await api<any>("/v1/groups", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const id = String(res?.id ?? "");
      await loadConversations();
      if (id) {
        router.replace(`/chat/${id}`);
      } else {
        router.back();
      }
    } catch (e: any) {
      Alert.alert("Could not create group", e?.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "New group" }} />
      <View style={styles.root}>
        <Text style={styles.label}>Group name</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Project team"
          placeholderTextColor={colors.textMuted}
          maxLength={80}
          editable={!busy}
          autoFocus
        />
        <Text style={styles.label}>
          Invite members{picked.length ? ` (${picked.length})` : ""} · optional
        </Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends or username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          editable={!busy}
        />
        {loadingFriends ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            style={styles.list}
            data={rows}
            keyExtractor={(f) => f.userId}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>
                {lookupBusy
                  ? "Searching…"
                  : friends.length === 0 && !query.trim()
                    ? "No friends yet. Search a username to invite anyone, or create alone."
                    : "No matches."}
              </Text>
            }
            renderItem={({ item: f }) => {
              const selected = picked.includes(f.userId);
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => togglePick(f)}
                  disabled={busy}
                >
                  <Avatar name={f.displayName} url={f.avatarUrl} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {f.displayName}
                    </Text>
                    <Text style={styles.meta}>
                      @{f.username}
                      {!f.isFriend ? " · Not a friend" : ""}
                    </Text>
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
        )}
        <Pressable
          style={[styles.btn, (busy || !title.trim()) && { opacity: 0.6 }]}
          onPress={create}
          disabled={busy || !title.trim()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Create group</Text>
          )}
        </Pressable>
      </View>
    </>
  );
}

function makeStyles(c: ColorTokens) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    label: { fontSize: 13, fontWeight: "600", color: c.textSecondary, marginTop: 4 },
    input: {
      backgroundColor: c.inputBg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      color: c.text,
      fontSize: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    list: { flex: 1, marginTop: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    name: { fontSize: 15, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    empty: { color: c.textMuted, fontSize: 13, marginTop: 16, lineHeight: 18 },
    btn: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
      marginTop: spacing.sm,
    },
    btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
