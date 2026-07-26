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
import { Redirect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, api, takeSessionRevokedReason } from "../src/lib/api";
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
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsChallengeId, setSmsChallengeId] = useState("");
  const [smsHint, setSmsHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCaptcha = useCallback(async () => {
    try {
      const data = await api<any>("/v1/auth/captcha");
      setCaptchaId(String(data?.captcha_id ?? data?.id ?? ""));
      setCaptchaImage(String(data?.image ?? "").trim());
    } catch (e: any) {
      setError(e.message || "Captcha unavailable");
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reason = await takeSessionRevokedReason();
      if (cancelled || !reason) return;
      setError(
        reason === "banned"
          ? "Your account was banned. Contact an administrator."
          : "Signed out — another device of this type signed in."
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (ready && signedIn) {
    return <Redirect href="/(tabs)/chats" />;
  }

  async function sendRegisterOTP() {
    setSmsBusy(true);
    setError(null);
    setSmsHint(null);
    try {
      const data = await api<any>("/v1/auth/register/otp", {
        method: "POST",
        body: JSON.stringify({
          phone,
          captcha_id: captchaId,
          captcha: captchaCode,
        }),
      });
      setSmsChallengeId(String(data?.challenge_id ?? ""));
      if (data?.dev_code) {
        setSmsHint(`Dev SMS code: ${data.dev_code}`);
        setSmsCode(String(data.dev_code));
      } else {
        setSmsHint("SMS code sent");
      }
      setCaptchaCode("");
      await loadCaptcha();
    } catch (e: any) {
      setError(formatErr(e));
      setCaptchaCode("");
      loadCaptcha();
    } finally {
      setSmsBusy(false);
    }
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
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
        payload.username = username || `user_${phone.slice(-4)}`;
        payload.sms_challenge_id = smsChallengeId;
        payload.sms_code = smsCode;
      } else {
        payload.remember_me = true;
      }
      const data = await api<any>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("No access_token in response");
      await signIn(String(token), String(data?.refresh_token ?? ""));
      router.replace("/(tabs)/chats");
    } catch (e: any) {
      setError(formatErr(e));
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
          <Text style={styles.heroSub}>Enterprise messaging</Text>
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
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="13800000002"
            styles={styles}
            colors={colors}
          />
          {mode === "register" && (
            <Text style={styles.hint}>After signup, join a company with an invite code in chat.</Text>
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
                if (mode === "register") {
                  if (!smsBusy) sendRegisterOTP();
                  return;
                }
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

          {mode === "register" && (
            <>
              <Pressable style={styles.secondaryBtn} onPress={sendRegisterOTP} disabled={smsBusy}>
                {smsBusy ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text style={styles.secondaryBtnText}>{t("login.sendCode")}</Text>
                )}
              </Pressable>
              {smsHint ? <Text style={styles.hint}>{smsHint}</Text> : null}
              <Field
                label={t("login.smsCode")}
                value={smsCode}
                onChangeText={setSmsCode}
                keyboardType="number-pad"
                returnKeyType="go"
                blurOnSubmit
                onSubmitEditing={() => {
                  if (!busy) onSubmit();
                }}
                styles={styles}
                colors={colors}
              />
            </>
          )}

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

function formatErr(e: any): string {
  if (e instanceof ApiError && e.fields) {
    const parts = Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`);
    return parts.length ? parts.join("; ") : e.message;
  }
  return e?.message || "Request failed";
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
    secondaryBtn: {
      borderWidth: 1,
      borderColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: 12,
      alignItems: "center" as const,
      marginBottom: spacing.sm,
    },
    secondaryBtnText: { color: c.accent, fontWeight: "600" as const },
    hint: { color: c.textSecondary, marginBottom: spacing.sm },
    error: { color: c.danger, marginTop: spacing.sm },
  };
}
