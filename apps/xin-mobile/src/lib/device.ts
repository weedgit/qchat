import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "xinchat.device_id";

function newDeviceId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable install id for call signaling; session class is always phone. */
export async function getDeviceId(): Promise<string> {
  try {
    let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!id) {
      id = newDeviceId();
      await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return newDeviceId();
  }
}

function mobilePlatformLabel(): string {
  const model = Device.modelName || Device.deviceName || "Phone";
  const os = Platform.OS === "ios" ? "iOS" : "Android";
  const ver = String(Device.osVersion || Platform.Version || "");
  const osPart = ver ? `${os} ${ver}` : os;
  // e.g. "Android · Samsung Galaxy S24" / "iOS 17.4 · iPhone 15"
  if (Platform.OS === "ios") {
    return `${osPart} · ${model}`;
  }
  return `${osPart} · ${model}`;
}

/** Auth session device — one phone session per account (with web + desktop). */
export async function getAuthDevice(): Promise<{
  deviceType: "phone";
  deviceName: string;
  deviceId: string;
  platform: string;
}> {
  const model = Device.modelName || Device.deviceName || "Android";
  const os = Platform.OS === "ios" ? "iOS" : "Android";
  const deviceId = await getDeviceId();
  const platform = mobilePlatformLabel();
  return {
    deviceType: "phone",
    deviceName: `XinChat Mobile (${os} · ${model})`,
    deviceId,
    platform: `Mobile · ${platform}`,
  };
}
