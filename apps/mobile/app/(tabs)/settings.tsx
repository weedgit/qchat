/**
 * App settings — appearance, notifications, sessions, phone, about
 * (Mattermost Account Settings / Display → Theme).
 */
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import {
  themeModeLabel,
  useTheme,
  useThemedStyles,
} from "../../src/context/ThemeContext";
import { api, apiBaseUrl } from "../../src/lib/api";
import {
  darkColors,
  radius,
  spacing,
  type ColorTokens,
  type ThemeMode,
} from "../../src/theme";

type NotifyProps = {
  desktop: "all" | "mention" | "none";
  sound: boolean;
  mentions_only: boolean;
};

type LoginSession = {
  id: string;
  device_type: string;
  device_name: string;
  platform: string;
  location: string;
  current?: boolean;
  created_at: string;
  last_active_at: string;
};

function formatSessionActive(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleString();
}

function sessionTitle(s: LoginSession): string {
  const platform = s.platform.trim();
  if (
    platform &&
    !["web", "desktop", "phone", "mobile", "browser"].includes(platform.toLowerCase())
  ) {
    return platform;
  }
  if (s.device_name && s.device_name.toLowerCase() !== "web") return s.device_name;
  if (s.device_type === "phone") return "Mobile";
  if (s.device_type === "desktop") return "Desktop";
  return "Web";
}

export default function SettingsScreen() {
  const { user, refreshMe, signOut } = useAuth();
  const { theme, setTheme, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notify, setNotify] = useState<NotifyProps>({
    desktop: "all",
    sound: true,
    mentions_only: false,
  });
  const [notifySaved, setNotifySaved] = useState(false);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [phoneHint, setPhoneHint] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const rows = await api<any>("/v1/me/sessions");
      const list = Array.isArray(rows) ? rows : [];
      setSessions(
        list.map((s: any) => ({
          id: String(s?.id ?? ""),
          device_type: String(s?.device_type ?? ""),
          device_name: String(s?.device_name ?? ""),
          platform: String(s?.platform ?? s?.device_name ?? ""),
          location: String(s?.location ?? s?.ip_region ?? s?.ip ?? ""),
          current: Boolean(s?.current),
          created_at: String(s?.created_at ?? ""),
          last_active_at: String(s?.last_active_at ?? s?.created_at ?? ""),
        }))
      );
    } catch {
      setSessions([]);
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api<any>("/v1/me");
      setPhone(String(u?.phone ?? ""));
      await refreshMe().catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Could not load account");
    }
    try {
      const p = await api<any>("/v1/me/notify_props");
      setNotify({
        desktop: p?.desktop === "mention" || p?.desktop === "none" ? p.desktop : "all",
        sound: p?.sound !== false,
        mentions_only: Boolean(p?.mentions_only),
      });
    } catch {
      /* keep defaults */
    }
    await loadSessions();
  }, [loadSessions, refreshMe]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onSaveNotify() {
    setSaving(true);
    setNotifySaved(false);
    setError(null);
    try {
      await api("/v1/me/notify_props", {
        method: "PUT",
        body: JSON.stringify(notify),
      });
      setNotifySaved(true);
    } catch (e: any) {
      setError(e?.message || "Could not save notifications");
    } finally {
      setSaving(false);
    }
  }

  async function revokeSession(s: LoginSession) {
    const label = s.current ? "Sign out of this device?" : "Revoke this session?";
    Alert.alert(s.current ? "Sign out" : "Revoke session", label, [
      { text: "Cancel", style: "cancel" },
      {
        text: s.current ? "Sign out" : "Revoke",
        style: "destructive",
        onPress: async () => {
          setSessionsBusy(true);
          setError(null);
          try {
            await api(`/v1/me/sessions/${s.id}`, { method: "DELETE" });
            if (s.current) {
              await signOut();
              router.replace("/login");
              return;
            }
            await loadSessions();
          } catch (e: any) {
            setError(e?.message || "Could not revoke session");
          } finally {
            setSessionsBusy(false);
          }
        },
      },
    ]);
  }

  async function requestPhoneChange() {
    if (newPhone.length !== 11) return;
    setSaving(true);
    setPhoneHint(null);
    try {
      const res = await api<any>("/v1/me/phone/request", {
        method: "POST",
        body: JSON.stringify({ new_phone: newPhone }),
      });
      setChallengeId(String(res?.challenge_id ?? ""));
      setPhoneHint(
        res?.dev_code
          ? `SMS sent (dev code: ${res.dev_code})`
          : "SMS code sent. Enter it below."
      );
    } catch (e: any) {
      setPhoneHint(e?.message || "Could not send SMS");
    } finally {
      setSaving(false);
    }
  }

  async function confirmPhoneChange() {
    if (!phoneCode) return;
    setSaving(true);
    setPhoneHint(null);
    try {
      const res = await api<any>("/v1/me/phone/confirm", {
        method: "POST",
        body: JSON.stringify({ challenge_id: challengeId, code: phoneCode }),
      });
      setPhone(String(res?.phone ?? newPhone));
      setChallengeId("");
      setPhoneCode("");
      setNewPhone("");
      setPhoneHint("Phone updated.");
      await refreshMe();
    } catch (e: any) {
      setPhoneHint(e?.message || "Could not confirm phone");
    } finally {
      setSaving(false);
    }
  }

  function onLogout() {
    Alert.alert("Sign out", "Sign out of this account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/login");
        },
      },
    ]);
  }

  function pickDesktopNotify() {
    Alert.alert("Notifications", undefined, [
      {
        text: "All new messages",
        onPress: () => setNotify({ ...notify, desktop: "all" }),
      },
      {
        text: "Mentions only",
        onPress: () => setNotify({ ...notify, desktop: "mention" }),
      },
      {
        text: "Nothing",
        onPress: () => setNotify({ ...notify, desktop: "none" }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function pickTheme() {
    const order: ThemeMode[] = ["dark", "light", "system"];
    Alert.alert("Theme", "Mattermost Display → Theme", [
      ...order.map((mode) => ({
        text: themeModeLabel(mode) + (theme === mode ? " ✓" : ""),
        onPress: () => setTheme(mode),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  const desktopLabel =
    notify.desktop === "mention"
      ? "Mentions only"
      : notify.desktop === "none"
        ? "Nothing"
        : "All new messages";

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.hero}>
        <Ionicons name="settings-outline" size={28} color="#fff" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroTitle}>Settings</Text>
          <Text style={styles.heroSub}>
            {user?.nickname || user?.username || "Account"} · notifications & security
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Appearance</Text>
        <Text style={styles.cardHint}>Mattermost Display → Theme</Text>
        <SelectRow
          label="Theme"
          value={themeModeLabel(theme)}
          onPress={pickTheme}
          styles={styles}
          colors={colors}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>
        <Text style={styles.cardHint}>Mattermost-style notify preferences</Text>
        <SelectRow
          label="Desktop notifications"
          value={desktopLabel}
          onPress={pickDesktopNotify}
          styles={styles}
          colors={colors}
        />
        <ToggleRow
          label="Play notification sound"
          value={notify.sound}
          onValueChange={(v) => setNotify({ ...notify, sound: v })}
          styles={styles}
          colors={colors}
        />
        <ToggleRow
          label="Mentions only"
          value={notify.mentions_only}
          onValueChange={(v) => setNotify({ ...notify, mentions_only: v })}
          styles={styles}
          colors={colors}
        />
        <Pressable style={styles.primaryBtn} onPress={onSaveNotify} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Save notifications</Text>
          )}
        </Pressable>
        {notifySaved ? <Text style={styles.hint}>Saved</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Login sessions</Text>
        <Text style={styles.cardHint}>
          One web, one desktop, and one phone session. Location is estimated from IP.
        </Text>
        {sessions.length === 0 ? (
          <Text style={styles.muted}>No active sessions.</Text>
        ) : (
          sessions.map((s) => (
            <View key={s.id} style={styles.sessionRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sessionTitle}>
                  {sessionTitle(s)}
                  {s.current ? " · This device" : ""}
                </Text>
                <Text style={styles.muted}>{s.location || "Unknown location"}</Text>
                <Text style={styles.mutedSmall}>
                  Last active {formatSessionActive(s.last_active_at || s.created_at)}
                </Text>
              </View>
              <Pressable
                style={styles.ghostBtn}
                disabled={sessionsBusy}
                onPress={() => revokeSession(s)}
              >
                <Text style={styles.ghostBtnText}>{s.current ? "Sign out" : "Revoke"}</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change phone number</Text>
        <Text style={styles.cardHint}>Current: {phone || "—"}</Text>
        <Field
          label="New 11-digit phone"
          value={newPhone}
          onChangeText={setNewPhone}
          keyboardType="phone-pad"
          maxLength={11}
          styles={styles}
          colors={colors}
        />
        {!challengeId ? (
          <Pressable
            style={[styles.primaryBtn, newPhone.length !== 11 && styles.btnDisabled]}
            onPress={requestPhoneChange}
            disabled={saving || newPhone.length !== 11}
          >
            <Text style={styles.primaryBtnText}>Send SMS code</Text>
          </Pressable>
        ) : (
          <>
            <Field
              label="Verification code"
              value={phoneCode}
              onChangeText={setPhoneCode}
              keyboardType="number-pad"
              styles={styles}
              colors={colors}
            />
            <Pressable
              style={[styles.primaryBtn, !phoneCode && styles.btnDisabled]}
              onPress={confirmPhoneChange}
              disabled={saving || !phoneCode}
            >
              <Text style={styles.primaryBtnText}>Confirm phone change</Text>
            </Pressable>
          </>
        )}
        {phoneHint ? <Text style={styles.hint}>{phoneHint}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>About</Text>
        <Text style={styles.label}>API server</Text>
        <Text style={styles.muted}>{apiBaseUrl()}</Text>
      </View>

      <Pressable style={styles.logout} onPress={onLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Field({
  label,
  hint,
  styles,
  colors,
  ...props
}: {
  label: string;
  hint?: string;
  styles: Styles;
  colors: ColorTokens;
} & ComponentProps<typeof TextInput>) {
  const editable = props.editable !== false;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function SelectRow({
  label,
  value,
  onPress,
  styles,
  colors,
}: {
  label: string;
  value: string;
  onPress: () => void;
  styles: Styles;
  colors: ColorTokens;
}) {
  return (
    <Pressable style={styles.selectRow} onPress={onPress}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.selectValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
  styles,
  colors,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  styles: Styles;
  colors: ColorTokens;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

function makeStyles(c: ColorTokens) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
    error: {
      color: c.danger,
      backgroundColor: c.bg === darkColors.bg ? "#3f1d1d" : "#fef2f2",
      padding: spacing.md,
      borderRadius: radius.md,
      overflow: "hidden" as const,
    },
    hero: {
      backgroundColor: c.headerBlue,
      borderRadius: radius.lg,
      padding: spacing.lg,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.md,
    },
    heroTitle: { color: "#fff", fontSize: 20, fontWeight: "700" as const },
    heroSub: { color: "rgba(255,255,255,0.85)", marginTop: 2, fontSize: 13 },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 10,
    },
    cardTitle: { fontSize: 16, fontWeight: "700" as const, color: c.text },
    cardHint: { fontSize: 12, color: c.textMuted, marginTop: -4 },
    field: { gap: 4 },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: "500" as const },
    input: {
      backgroundColor: c.inputBg,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      fontSize: 15,
      color: c.text,
    },
    inputDisabled: { color: c.textMuted },
    fieldHint: { fontSize: 11, color: c.textMuted },
    selectRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm,
      paddingVertical: 6,
    },
    selectValue: { color: c.text, fontSize: 15, marginTop: 2 },
    toggleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: spacing.md,
      paddingVertical: 4,
    },
    toggleLabel: { flex: 1, color: c.text, fontSize: 15 },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.sm,
      paddingVertical: 12,
      alignItems: "center" as const,
      marginTop: 4,
    },
    btnDisabled: { opacity: 0.45 },
    primaryBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
    hint: { color: c.textSecondary, fontSize: 13 },
    muted: { color: c.textSecondary, fontSize: 13 },
    mutedSmall: { color: c.textMuted, fontSize: 11, marginTop: 2 },
    sessionRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    sessionTitle: { fontWeight: "600" as const, color: c.text, fontSize: 14 },
    ghostBtn: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: radius.sm,
      backgroundColor: c.inputBg,
    },
    ghostBtnText: { color: c.accent, fontWeight: "600" as const, fontSize: 13 },
    logout: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center" as const,
    },
    logoutText: { color: c.danger, fontWeight: "600" as const, fontSize: 16 },
  };
}
