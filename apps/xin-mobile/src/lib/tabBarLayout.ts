import { Platform } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { spacing } from "../theme";

/** Bottom tab bar height + padding so tabs stay above Android system navigation. */
export function tabBarLayoutInsets(insets: EdgeInsets) {
  let bottomPad = insets.bottom;
  // Some Android builds report 0 while the system nav bar still overlays the window.
  if (Platform.OS === "android" && bottomPad < 12) {
    bottomPad = 28;
  }
  bottomPad = Math.max(bottomPad, Platform.OS === "android" ? spacing.sm : 0);
  const base = Platform.OS === "ios" ? 49 : 56;
  return {
    bottomPad,
    height: base + bottomPad + spacing.xs,
    paddingTop: spacing.xs,
  };
}
