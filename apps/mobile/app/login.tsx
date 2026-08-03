import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { formatApiError } from "@qchat/i18n";
import { Redirect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, takeSessionRevokedReason } from "../src/lib/api";
import { validateLoginCredentials } from "../src/lib/credentials";
import { getAuthDevice, useAuth } from "../src/context/AuthContext";
import { useLocale } from "../src/context/LocaleContext";
import { useTheme, useThemedStyles } from "../src/context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../src/theme";

export default function LoginScreen() {
  const { signedIn, ready, signIn } = useAuth();
  const { colors } = useTheme();
  const { t } = useLocale();
  const styles = useThemedStyles(makeStyles);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCaptcha = useCallback(async () => {
    try {
      const data = await api<any>("/v1/auth/captcha");
      setCaptchaId(String(data?.captcha_id ?? data?.id ?? ""));
      setCaptchaImage(String(data?.image ?? "").trim());
    } catch (e: unknown) {
      setError(formatApiError(e, t, "login.captchaUnavailable"));
    }
  }, [t]);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reason = await takeSessionRevokedReason();
      if (cancelled || !reason) return;
      setError(
        reason === "banned" ? t("login.errBanned") : t("login.errSignedOut")
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (ready && signedIn) {
    return <Redirect href="/(tabs)/chats" />;
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      const early = validateLoginCredentials({
        phone,
        password,
        username,
        requireUsername: mode === "register",
      });
      if (early) {
        setError(t(early as any));
        return;
      }
      if (mode === "register" && !inviteCode.trim()) {
        setError(t("login.inviteRequired"));
        return;
      }
      const device = await getAuthDevice();
      const payload: Record<string, unknown> = {
        phone,
        password,
        captcha_id: captchaId,
        captcha: captchaCode,
        device_type: device.deviceType,
        device_name: device.deviceName,
        device_id: device.deviceId,
        platform: device.platform,
      };
      if (mode === "register") {
        payload.username = username.trim();
        payload.invite_code = inviteCode.trim().toUpperCase();
      } else {
        payload.remember_me = true;
      }
      const data = await api<any>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error(t("login.errNoToken"));
      await signIn(String(token), String(data?.refresh_token ?? ""));
      router.replace("/(tabs)/chats");
    } catch (e: unknown) {
      setError(
        formatApiError(e, t, mode === "register" ? "login.errGeneric" : "login.requestFailed")
      );
      setCaptchaCode("");
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <SafeAreaView edges={["top"]}>
          <Text style={styles.brand}>{t("app.name")}</Text>
          <Text style={styles.heroSub}>{t("login.enterpriseMessaging")}</Text>
        </SafeAreaView>
      </View>
      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.sheetInner} keyboardShouldPersistTaps="handled">
          <View style={styles.modeRow}>
            <Pressable onPress={() => setMode("login")} style={styles.modeBtn}>
              <Text style={[styles.modeText, mode === "login" && styles.modeActive]}>
                {t("login.title")}
              </Text>
            </Pressable>
            <Pressable onPress={() => setMode("register")} style={styles.modeBtn}>
              <Text style={[styles.modeText, mode === "register" && styles.modeActive]}>
                {t("login.register")}
              </Text>
            </Pressable>
          </View>

          <Field
            label={t("login.phone")}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(0, 11))}
            keyboardType="phone-pad"
            placeholder="13800000002"
            styles={styles}
            colors={colors}
          />
          {mode === "register" && (
            <Text style={styles.hint}>{t("login.subtitleRegister")}</Text>
          )}
          {mode === "register" && (
            <Field
              label={t("login.username")}
              value={username}
              onChangeText={setUsername}
              placeholder="alice"
              styles={styles}
              colors={colors}
            />
          )}
          {mode === "register" && (
            <Field
              label={t("login.inviteCode")}
              value={inviteCode}
              onChangeText={(v) => setInviteCode(v.toUpperCase())}
              placeholder="ACME2026"
              autoCapitalize="characters"
              styles={styles}
              colors={colors}
            />
          )}
          {mode === "register" && (
            <Text style={styles.hint}>{t("login.inviteHint")}</Text>
          )}
          <Field
            label={t("login.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="at least 8 chars"
            styles={styles}
            colors={colors}
          />

          <Text style={styles.label}>{t("login.captcha")}</Text>
          <View style={styles.captchaRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={captchaCode}
              onChangeText={(t) => setCaptchaCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              textContentType="oneTimeCode"
              placeholder="CODE"
              placeholderTextColor={colors.textMuted}
              returnKeyType="go"
              blurOnSubmit
              onSubmitEditing={() => {
                if (!busy) onSubmit();
              }}
            />
            <View style={styles.captchaBox} pointerEvents="none">
              {captchaImage ? (
                <Image source={{ uri: captchaImage }} style={styles.captchaImage} resizeMode="contain" />
              ) : (
                <Text style={styles.captchaText}>…</Text>
              )}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.primaryBtn} onPress={onSubmit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {mode === "login" ? t("login.submitLogin") : t("login.submitRegister")}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Field({
  label,
  styles,
  colors,
  ...props
}: {
  label: string;
  styles: Styles;
  colors: ColorTokens;
} & ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}

function makeStyles(c: ColorTokens) {
  return {
    root: { flex: 1, backgroundColor: c.headerBlue },
    hero: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
    brand: { color: "#fff", fontSize: 36, fontWeight: "800" as const, marginTop: spacing.lg },
    heroSub: { color: "rgba(255,255,255,0.85)", marginTop: spacing.xs, fontSize: 15 },
    sheet: {
      flex: 1,
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    sheetInner: { padding: spacing.xl, paddingBottom: 48 },
    modeRow: { flexDirection: "row" as const, gap: spacing.lg, marginBottom: spacing.lg },
    modeBtn: { paddingVertical: spacing.sm },
    modeText: { fontSize: 17, color: c.textMuted, fontWeight: "600" as const },
    modeActive: { color: c.accent },
    label: { color: c.textSecondary, fontSize: 13, marginBottom: 6, fontWeight: "500" as const },
    input: {
      backgroundColor: c.inputBg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      fontSize: 16,
      color: c.text,
    },
    captchaRow: { flexDirection: "row" as const, gap: spacing.sm, marginBottom: spacing.md },
    captchaBox: {
      width: 132,
      height: 48,
      backgroundColor: "#fff",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      overflow: "hidden" as const,
    },
    captchaImage: { width: 132, height: 48 },
    captchaText: { fontWeight: "700" as const, color: c.accent, letterSpacing: 2, fontSize: 18 },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center" as const,
      marginTop: spacing.md,
    },
    primaryBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 16 },
    hint: { color: c.textSecondary, marginBottom: spacing.sm },
    error: {
      color: c.danger,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: "rgba(220, 50, 50, 0.12)",
      overflow: "hidden" as const,
      fontWeight: "500" as const,
    },
  };
}
