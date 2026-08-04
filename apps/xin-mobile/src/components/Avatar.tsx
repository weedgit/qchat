import { Text, View, Image } from "react-native";
import { mediaAuthURL } from "../lib/api";
import { useThemedStyles } from "../context/ThemeContext";
import type { ColorTokens } from "../theme";

export function Avatar({
  name,
  url,
  size = 48,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const src = mediaAuthURL(url);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
        },
      ]}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
      )}
    </View>
  );
}

function makeStyles(c: ColorTokens) {
  return {
    wrap: {
      backgroundColor: c.accent,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      overflow: "hidden" as const,
    },
    initial: {
      color: "#fff",
      fontWeight: "700" as const,
    },
  };
}
