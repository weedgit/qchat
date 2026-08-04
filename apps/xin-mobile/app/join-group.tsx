/**
 * Scan / paste a QR payload to join a group or add a contact.
 * - qchat://join/{publicId} → group join request
 * - qchat://user/{username} → open profile (Add contact)
 */
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import {
  CameraView,
  type BarcodeScanningResult,
  useCameraPermissions,
} from "expo-camera";
import { api, asList } from "../src/lib/api";
import { parseGroupJoinPayload } from "../src/lib/groupQr";
import { parseUserPayload } from "../src/lib/userQr";
import { useChat } from "../src/context/ChatContext";
import { useTheme, useThemedStyles } from "../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../src/theme";

export default function JoinGroupScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { loadConversations } = useChat();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handledScan = useRef(false);

  const openUserFromUsername = useCallback(async (username: string) => {
    const body = await api<any>(`/v1/users/lookup?q=${encodeURIComponent(username)}`);
    const users = asList(body, "users") as Array<{ id?: string; username?: string }>;
    const hit =
      users.find((u) => String(u?.username ?? "").toLowerCase() === username.toLowerCase()) ??
      users[0];
    const id = String(hit?.id ?? "").trim();
    if (!id) throw new Error("User not found");
    router.replace({ pathname: "/user/[id]", params: { id } });
  }, []);

  const submitPublicId = useCallback(
    async (publicId: string) => {
      if (!publicId) {
        Alert.alert("Join group", "Enter a group invite ID or scan a qchat://join/… QR code.");
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
        handledScan.current = false;
      } finally {
        setBusy(false);
        setScanning(false);
      }
    },
    [loadConversations]
  );

  const handlePayload = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        Alert.alert(
          "Scan QR",
          "Scan a group invite (qchat://join/…) or a profile QR (qchat://user/…)."
        );
        return;
      }

      const userName = parseUserPayload(trimmed);
      if (userName) {
        setBusy(true);
        try {
          await openUserFromUsername(userName);
        } catch (e: any) {
          Alert.alert("Could not add contact", e?.message || "User not found");
          handledScan.current = false;
        } finally {
          setBusy(false);
          setScanning(false);
        }
        return;
      }

      const publicId = parseGroupJoinPayload(trimmed) ?? (/^G[A-Za-z0-9]+$/i.test(trimmed) ? trimmed : "");
      if (!publicId) {
        Alert.alert(
          "Unrecognized QR",
          "This code is not a group invite or profile QR. Ask them to show their XinChat QR."
        );
        handledScan.current = false;
        return;
      }
      await submitPublicId(publicId);
    },
    [openUserFromUsername, submitPublicId]
  );

  async function submit() {
    await handlePayload(raw);
  }

  async function startScan() {
    if (Platform.OS === "web") {
      Alert.alert("Camera scan", "QR camera scan is available on iOS and Android builds.");
      return;
    }
    const granted = permission?.granted
      ? true
      : (await requestPermission()).granted;
    if (!granted) {
      Alert.alert(
        "Camera permission",
        "Allow camera access to scan a group invite or profile QR, or paste the code instead."
      );
      return;
    }
    handledScan.current = false;
    setScanning(true);
  }

  function onBarcode(result: BarcodeScanningResult) {
    if (busy || handledScan.current) return;
    const data = String(result?.data ?? "").trim();
    if (!data) return;
    // Accept as soon as we recognize either payload type.
    if (!parseUserPayload(data) && !parseGroupJoinPayload(data)) return;
    handledScan.current = true;
    setRaw(data);
    void handlePayload(data);
  }

  if (scanning) {
    return (
      <>
        <Stack.Screen options={{ title: "Scan QR" }} />
        <View style={styles.scanRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcode}
          />
          <View style={styles.scanOverlay} pointerEvents="box-none">
            <Text style={styles.scanHint}>
              Point at a group invite or profile QR
            </Text>
            <View style={styles.scanFrame} />
            <Pressable
              style={[styles.btn, styles.scanCancel, busy && { opacity: 0.6 }]}
              onPress={() => {
                if (!busy) setScanning(false);
              }}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Cancel</Text>
              )}
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Scan QR" }} />
      <View style={styles.root}>
        <Text style={styles.title}>Join group or add contact</Text>
        <Text style={styles.hint}>
          Scan a group invite QR (qchat://join/…) or a profile QR (qchat://user/…). You can also
          paste the payload or type a group invite ID (G…).
        </Text>
        <Pressable
          style={[styles.btnSecondary, busy && { opacity: 0.6 }]}
          onPress={startScan}
          disabled={busy}
        >
          <Text style={styles.btnSecondaryText}>Scan QR code</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={raw}
          onChangeText={setRaw}
          placeholder="qchat://join/… or qchat://user/…"
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
            <Text style={styles.btnText}>Continue</Text>
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
    btnSecondary: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    btnSecondaryText: { color: c.accent, fontWeight: "700", fontSize: 16 },
    scanRoot: { flex: 1, backgroundColor: "#000" },
    scanOverlay: {
      flex: 1,
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
    },
    scanHint: {
      color: "#fff",
      fontSize: 15,
      fontWeight: "600",
      textAlign: "center",
      backgroundColor: "rgba(0,0,0,0.45)",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.md,
      overflow: "hidden",
    },
    scanFrame: {
      width: 240,
      height: 240,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.85)",
    },
    scanCancel: { alignSelf: "stretch" },
  });
}
