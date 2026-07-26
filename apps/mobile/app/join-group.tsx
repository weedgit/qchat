/**
 * Join a group by invite ID or pasted QR payload (qchat://join/…).
 * Requests still require owner/admin approval.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { api } from "../src/lib/api";
import { parseGroupJoinPayload } from "../src/lib/groupQr";
import { useChat } from "../src/context/ChatContext";
import { useTheme, useThemedStyles } from "../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../src/theme";

export default function JoinGroupScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { loadConversations } = useChat();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const publicId = parseGroupJoinPayload(raw) ?? raw.trim();
    if (!publicId) {
      Alert.alert("Join group", "Enter a group invite ID or paste a qchat://join/… code.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<any>("/v1/groups/join", {
        method: "POST",
        body: JSON.stringify({ public_id: publicId }),
      });
      await loadConversations();
      const status = String(res?.status ?? res?.role ?? "pending");
      if (status === "pending") {
        Alert.alert(
          "Request sent",
          "Waiting for the group owner or an admin to approve your join request."
        );
      } else {
        Alert.alert("Joined", "You are now a member of this group.");
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Could not join", e?.message || "Join request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Join group" }} />
      <View style={styles.root}>
        <Text style={styles.title}>Join by ID or QR</Text>
        <Text style={styles.hint}>
          Paste a scanned qchat://join/… payload or type the group invite ID (G…). Join requests
          need owner or admin approval.
        </Text>
        <TextInput
          style={styles.input}
          value={raw}
          onChangeText={setRaw}
          placeholder="Gxxxxxxxx or qchat://join/…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Pressable
          style={[styles.btn, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Request to join</Text>
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
      gap: spacing.md,
    },
    title: { fontSize: 18, fontWeight: "700", color: c.text },
    hint: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
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
    btn: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
    },
    btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
