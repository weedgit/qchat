import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Avatar } from "../../src/components/Avatar";
import { useAuth } from "../../src/context/AuthContext";
import { apiBaseUrl } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";

export default function MeScreen() {
  const { user, signOut } = useAuth();

  async function onLogout() {
    Alert.alert("退出登录", "确定退出当前账号？", [
      { text: "取消", style: "cancel" },
      {
        text: "退出",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/login");
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Avatar name={user?.nickname || "Me"} url={user?.avatarUrl} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.nickname || "—"}</Text>
          <Text style={styles.sub}>@{user?.username}</Text>
          <Text style={styles.sub}>{user?.phone}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Row label="API" value={apiBaseUrl()} />
        <Row label="用户 ID" value={user?.id || "—"} />
      </View>

      <Pressable style={styles.logout} onPress={onLogout}>
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.md, gap: spacing.md },
  card: {
    backgroundColor: colors.headerBlue,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  name: { color: "#fff", fontSize: 20, fontWeight: "700" },
  sub: { color: "rgba(255,255,255,0.85)", marginTop: 2, fontSize: 13 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 13, flexShrink: 1, maxWidth: "65%" },
  logout: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  logoutText: { color: colors.danger, fontWeight: "600", fontSize: 16 },
});
