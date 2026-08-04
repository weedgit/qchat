import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import QRCode from "qrcode";
import { encodeGroupJoinPayload } from "../lib/groupQr";
import { useTheme } from "../context/ThemeContext";
import { spacing } from "../theme";

type Props = {
  publicId: string;
  size?: number;
};

/** Client-side group join QR (join still uses POST /v1/groups/join). */
export function GroupQr({ publicId, size = 180 }: Props) {
  const { colors } = useTheme();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const payload = encodeGroupJoinPayload(publicId);

  useEffect(() => {
    if (!payload) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: size,
      margin: 1,
      color: { dark: "#0e1621", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  if (!publicId || !dataUrl) return null;

  return (
    <View style={styles.wrap}>
      <Image
        source={{ uri: dataUrl }}
        style={{ width: size, height: size, borderRadius: 8, backgroundColor: "#fff" }}
        accessibilityLabel={`QR code to join group ${publicId}`}
      />
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Scan to request join · {publicId}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  hint: { fontSize: 12, textAlign: "center" },
});
