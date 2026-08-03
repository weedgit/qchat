/**
 * App settings — appearance, notifications, sessions, phone, about.
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
import type { LocaleMode } from "@qchat/i18n";
import { useAuth } from "../../src/context/AuthContext";
import { useLocale } from "../../src/context/LocaleContext";
import { useTheme, useThemedStyles } from "../../src/context/ThemeContext";
import { api, apiBaseUrl } from "../../src/lib/api";
import {
  normalizeNotifyProps,
  saveLocalNotifyProps,
  withDesktop,
  withMentionsOnly,
  type NotifyProps,
} from "../../src/lib/notifyProps";
import {
  darkColors,
  radius,
  spacing,
  type ColorTokens,
  type ThemeMode,
} from "../../src/theme";

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
  const { t, locale, setLocale, labelLocale, labelTheme } = useLocale();
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
  const [phonePassword, setPhonePassword] = useState("");
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
      const next = normalizeNotifyProps(p);
      setNotify(next);
      await saveLocalNotifyProps(next);
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
      await saveLocalNotifyProps(notify);
      setNotifySaved(true);
    } catch (e: any) {
      setError(e?.message || "Could not save notifications");
    } finally {
      setSaving(false);
    }
  }

  async function revokeSession(s: LoginSession) {
    const label = s.current
      ? t("settings.signOutConfirmBody")
      : t("settings.revoke");
    Alert.alert(
      s.current ? t("settings.signOutConfirmTitle") : t("settings.revoke"),
      label,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: s.current ? t("nav.signOut") : t("settings.revoke"),
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
      ]
    );
  }

  async function updatePhone() {
    if (newPhone.length !== 11 || !phonePassword) return;
    setSaving(true);
    setPhoneHint(null);
    try {
      const res = await api<any>("/v1/me/phone", {
        method: "PUT",
        body: JSON.stringify({ new_phone: newPhone, password: phonePassword }),
      });
      setPhone(String(res?.phone ?? newPhone));
      setPhonePassword("");
      setNewPhone("");
      setPhoneHint(t("settings.phoneUpdated"));
      await refreshMe();
    } catch (e: any) {
      setPhoneHint(e?.message || "Could not update phone");
    } finally {
      setSaving(false);
    }
  }

  function onLogout() {
    Alert.alert(t("settings.signOutConfirmTitle"), t("settings.signOutConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("nav.signOut"),
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/login");
        },
      },
    ]);
  }

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
          <Text style={styles.heroTitle}>{t("settings.title")}</Text>
          <Text style={styles.heroSub}>
            {user?.nickname || user?.username || "Account"} · {t("settings.subtitle")}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("appearance.title")}</Text>
        <Text style={styles.cardHint}>{t("appearance.hint")}</Text>
        <DropdownSelect
          label={t("appearance.theme")}
          value={theme}
          options={(["dark", "light", "system"] as ThemeMode[]).map((mode) => ({
            value: mode,
            label: labelTheme(mode),
          }))}
          onChange={setTheme}
          styles={styles}
          colors={colors}
        />
        <DropdownSelect
          label={t("appearance.language")}
          value={locale}
          options={(["en", "zh"] as LocaleMode[]).map((mode) => ({
            value: mode,
            label: labelLocale(mode),
          }))}
          onChange={setLocale}
          styles={styles}
          colors={colors}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("settings.notifications")}</Text>
        <Text style={styles.cardHint}>
          Mute and sound preferences for local in-app banners while the app is open.
          Background delivery uses 个推 (Getui) with manufacturer channels on China
          Android; Expo Push is the fallback when Getui is not built in.
        </Text>
        <DropdownSelect
          label="Banner alerts"
          value={notify.desktop}
          options={[
            { value: "all" as const, label: t("settings.notifyAll") },
            { value: "mention" as const, label: t("settings.notifyMention") },
            { value: "none" as const, label: t("settings.notifyNone") },
          ]}
          onChange={(desktop) => {
            const next = withDesktop(notify, desktop);
            setNotify(next);
            saveLocalNotifyProps(next).catch(() => {});
          }}
          styles={styles}
          colors={colors}
        />
        <ToggleRow
          label={t("settings.playSound")}
          value={notify.sound}
          onValueChange={(v) => {
            const next = { ...notify, sound: v };
            setNotify(next);
            saveLocalNotifyProps(next).catch(() => {});
          }}
          styles={styles}
          colors={colors}
        />
        <ToggleRow
          label={t("settings.mentionsOnly")}
          value={notify.mentions_only}
          onValueChange={(v) => {
            const next = withMentionsOnly(notify, v);
            setNotify(next);
            saveLocalNotifyProps(next).catch(() => {});
          }}
          styles={styles}
          colors={colors}
        />
        <Pressable style={styles.primaryBtn} onPress={onSaveNotify} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t("settings.saveNotifications")}</Text>
          )}
        </Pressable>
        {notifySaved ? <Text style={styles.hint}>{t("common.saved")}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("settings.sessions")}</Text>
        <Text style={styles.cardHint}>{t("settings.sessionsHint")}</Text>
        {sessions.length === 0 ? (
          <Text style={styles.muted}>{t("settings.noSessions")}</Text>
        ) : (
          sessions.map((s) => (
            <View key={s.id} style={styles.sessionRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sessionTitle}>
                  {sessionTitle(s)}
                  {s.current ? ` · ${t("settings.thisDevice")}` : ""}
                </Text>
                <Text style={styles.muted}>
                  {s.location || t("settings.unknownLocation")}
                </Text>
                <Text style={styles.mutedSmall}>
                  {t("settings.lastActive")}{" "}
                  {formatSessionActive(s.last_active_at || s.created_at)}
                </Text>
              </View>
              <Pressable
                style={styles.ghostBtn}
                disabled={sessionsBusy}
                onPress={() => revokeSession(s)}
              >
                <Text style={styles.ghostBtnText}>
                  {s.current ? t("nav.signOut") : t("settings.revoke")}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("settings.changePhone")}</Text>
        <Text style={styles.cardHint}>
          {t("settings.currentPhone")}: {phone || "—"}
        </Text>
        <Text style={styles.cardHint}>{t("me.phoneHint")}</Text>
        <Field
          label={t("settings.newPhone")}
          value={newPhone}
          onChangeText={(v) => setNewPhone(v.replace(/\D/g, "").slice(0, 11))}
          keyboardType="phone-pad"
          maxLength={11}
          styles={styles}
          colors={colors}
        />
        <Field
          label={t("settings.confirmPassword")}
          value={phonePassword}
          onChangeText={setPhonePassword}
          secureTextEntry
          styles={styles}
          colors={colors}
        />
        <Pressable
          style={[
            styles.primaryBtn,
            (newPhone.length !== 11 || !phonePassword) && styles.btnDisabled,
          ]}
          onPress={updatePhone}
          disabled={saving || newPhone.length !== 11 || !phonePassword}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t("settings.confirmPhone")}</Text>
          )}
        </Pressable>
        {phoneHint ? <Text style={styles.hint}>{phoneHint}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("settings.about")}</Text>
        <Text style={styles.label}>{t("settings.apiServer")}</Text>
        <Text style={styles.muted}>{apiBaseUrl()}</Text>
      </View>

      <Pressable style={styles.logout} onPress={onLogout}>
        <Text style={styles.logoutText}>{t("nav.signOut")}</Text>
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

function DropdownSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  styles,
  colors,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  styles: Styles;
  colors: ColorTokens;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <View style={styles.dropdown}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.dropdownTrigger}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.dropdownTriggerText} numberOfLines={1}>
          {current}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>
      {open ? (
        <View style={styles.dropdownMenu}>
          {options.map((opt, index) => {
            const selected = opt.value === value;
            return (
              <Pressable
                key={opt.value}
                style={[
                  styles.dropdownOption,
                  index > 0 && styles.dropdownOptionDivider,
                  selected && styles.dropdownOptionActive,
                ]}
                onPress={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <Text
                  style={[styles.dropdownOptionText, selected && styles.dropdownOptionTextActive]}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
                {selected ? (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
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
    dropdown: { gap: 4 },
    dropdownTrigger: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm,
      backgroundColor: c.inputBg,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    dropdownTriggerText: { flex: 1, color: c.text, fontSize: 15 },
    dropdownMenu: {
      backgroundColor: c.inputBg,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: "hidden" as const,
    },
    dropdownOption: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    dropdownOptionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    dropdownOptionActive: {
      backgroundColor: c.bg === darkColors.bg ? "rgba(36,99,220,0.18)" : "rgba(36,99,220,0.08)",
    },
    dropdownOptionText: { flex: 1, color: c.text, fontSize: 15 },
    dropdownOptionTextActive: { color: c.accent, fontWeight: "600" as const },
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
