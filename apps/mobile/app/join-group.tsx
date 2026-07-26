/**
 * Join a group by invite ID, pasted QR payload, or live camera scan.
 * Requests still require owner/admin approval.
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
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handledScan = useRef(false);

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

  async function submit() {
    const publicId = parseGroupJoinPayload(raw) ?? raw.trim();
    await submitPublicId(publicId);
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
        "Allow camera access to scan a group invite QR code, or paste the invite instead."
      );
      return;
    }
    handledScan.current = false;
    setScanning(true);
  }

  function onBarcode(result: BarcodeScanningResult) {
    if (busy || handledScan.current) return;
    const publicId = parseGroupJoinPayload(String(result?.data ?? ""));
    if (!publicId) return;
    handledScan.current = true;
    setRaw(publicId);
    void submitPublicId(publicId);
  }

  if (scanning) {
    return (
      <>
        <Stack.Screen options={{ title: "Scan invite QR" }} />
        <View style={styles.scanRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcode}
          />
          <View style={styles.scanOverlay} pointerEvents="box-none">
            <Text style={styles.scanHint}>Point at a group invite QR code</Text>
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
      <Stack.Screen options={{ title: "Join group" }} />
      <View style={styles.root}>
        <Text style={styles.title}>Join by ID or QR</Text>
        <Text style={styles.hint}>
          Scan a group invite QR, paste a qchat://join/… payload, or type the group invite ID
          (G…). Join requests need owner or admin approval.
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
