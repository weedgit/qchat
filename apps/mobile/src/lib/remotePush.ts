/**
 * Expo Push registration → POST /v1/push/register.
 * Expo delivers via FCM (Android) / APNs (iOS) under the hood.
 * Native FCM/APNs tokens without Expo are server-supported when credentials exist;
 * this client path uses Expo tokens for the managed Expo app.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";
import { ensureNotificationPermissions } from "./localNotify";

let lastRegisteredToken: string | null = null;

function expoProjectId(): string | undefined {
  const eas =
    (Constants.easConfig as { projectId?: string } | null)?.projectId ||
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return typeof eas === "string" && eas.trim() ? eas.trim() : undefined;
}

function pushPlatform(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}

export async function registerExpoRemotePush(): Promise<{
  enabled: boolean;
  reason: string;
}> {
  if (!Device.isDevice) {
    return { enabled: false, reason: "simulator" };
  }
  const ok = await ensureNotificationPermissions();
  if (!ok) {
    return { enabled: false, reason: "permission_denied" };
  }

  const projectId = expoProjectId();
  let token: string;
  try {
    const result = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    token = String(result.data || "").trim();
  } catch (err) {
    return {
      enabled: false,
      reason: err instanceof Error ? err.message : "expo_token_failed",
    };
  }
  if (!token) {
    return { enabled: false, reason: "empty_token" };
  }

  try {
    await api("/v1/push/register", {
      method: "POST",
      body: JSON.stringify({
        platform: pushPlatform(),
        token,
        device_name: Device.modelName || Platform.OS,
      }),
    });
    lastRegisteredToken = token;
    return { enabled: true, reason: "registered" };
  } catch (err) {
    return {
      enabled: false,
      reason: err instanceof Error ? err.message : "register_failed",
    };
  }
}

export async function unregisterExpoRemotePush(): Promise<void> {
  const token = lastRegisteredToken;
  lastRegisteredToken = null;
  if (!token) return;
  try {
    await api("/v1/push/unregister", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  } catch {
    /* best-effort on logout */
  }
}
