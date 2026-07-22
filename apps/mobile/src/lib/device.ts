import * as Device from "expo-device";
import { Platform } from "react-native";

/** Auth session device fields — phone surface for mobile policy. */
export function getAuthDevice(): { deviceType: "phone"; deviceName: string } {
  const model = Device.modelName || Device.deviceName || "Android";
  const os = Platform.OS === "ios" ? "iOS" : "Android";
  return {
    deviceType: "phone",
    deviceName: `Qchat Mobile (${os} · ${model})`,
  };
}
