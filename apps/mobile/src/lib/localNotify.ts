/**
 * Local OS notifications while the app process is alive (WS-driven).
 * Prefer importing via `notifyPort` from messaging code.
 * Remote push uses Expo tokens via `notifyPort.registerRemote` (see remotePush.ts).
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { router } from "expo-router";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let channelReady = false;
let permissionAsked = false;

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || channelReady) return;
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Messages",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#2463dc",
    sound: "default",
  });
  channelReady = true;
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice && Platform.OS === "ios") {
    // Simulators often lack push; local notify still works on Android emulator.
  }
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  if (permissionAsked && current.status === "denied") return false;
  permissionAsked = true;
  const next = await Notifications.requestPermissionsAsync();
  return Boolean(
    next.granted || next.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

export type LocalMessageNotify = {
  conversationId?: string;
  title: string;
  body: string;
  sound?: boolean;
  /** Expo-router path when the banner is tapped (e.g. /contacts). */
  path?: string;
};

export async function presentMessageNotification(opts: LocalMessageNotify): Promise<void> {
  const ok = await ensureNotificationPermissions();
  if (!ok) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body || "New message",
      sound: opts.sound === false ? undefined : "default",
      data: {
        conversationId: opts.conversationId ?? "",
        path: opts.path ?? "",
      },
      ...(Platform.OS === "android" ? { channelId: "messages" } : {}),
    },
    trigger: null,
  });
}

/** Navigate when user taps a notification. */
export function attachNotificationResponseListener(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data ?? {};
    const path = String(data.path ?? "").trim();
    const convId = String(data.conversationId ?? "").trim();
    try {
      if (path) {
        router.push(path as any);
        return;
      }
      if (convId) {
        router.push(`/chat/${convId}`);
      }
    } catch {
      /* router may not be ready */
    }
  });
  return () => sub.remove();
}
