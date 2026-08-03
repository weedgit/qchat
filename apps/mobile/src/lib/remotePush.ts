/**
 * China-mainland remote push via 个推 (Getui).
 * Getui SDK obtains a CID; OEM channels (Huawei/Xiaomi/OPPO/vivo/Honor) are
 * enabled in the Getui developer console and delivered by the API SendGetui path.
 *
 * Falls back to Expo Push when the native module is missing or credentials unset.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";
import { ensureNotificationPermissions } from "./localNotify";

let lastRegistered: { platform: string; token: string } | null = null;

type GetuiNative = {
  initPush?: () => void;
  clientId?: (cb: (cid: string) => void) => void;
  getClientId?: (cb: (cid: string) => void) => void;
  turnOnPush?: () => void;
};

function getuiExtra(): { appId?: string; appKey?: string; appSecret?: string; enabled?: boolean } {
  return ((Constants.expoConfig?.extra as { getui?: Record<string, unknown> } | undefined)?.getui ||
    {}) as { appId?: string; appKey?: string; appSecret?: string; enabled?: boolean };
}

function loadGetuiModule(): GetuiNative | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-getui");
    const Getui = (mod?.default || mod) as GetuiNative;
    if (!Getui || typeof Getui.clientId !== "function") return null;
    return Getui;
  } catch {
    return null;
  }
}

function waitForClientId(mod: GetuiNative, timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("getui_cid_timeout")), timeoutMs);
    const done = (cid: string) => {
      clearTimeout(timer);
      const t = String(cid || "").trim();
      if (t) resolve(t);
      else reject(new Error("getui_empty_cid"));
    };
    try {
      if (typeof mod.initPush === "function") mod.initPush();
      if (typeof mod.turnOnPush === "function") mod.turnOnPush();
      if (typeof mod.clientId === "function") {
        mod.clientId(done);
        return;
      }
      if (typeof mod.getClientId === "function") {
        mod.getClientId(done);
        return;
      }
      clearTimeout(timer);
      reject(new Error("getui_api_missing"));
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error("getui_init_failed"));
    }
  });
}

function expoProjectId(): string | undefined {
  const eas =
    (Constants.easConfig as { projectId?: string } | null)?.projectId ||
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return typeof eas === "string" && eas.trim() ? eas.trim() : undefined;
}

async function registerExpoFallback(): Promise<{ enabled: boolean; reason: string }> {
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
  if (!token) return { enabled: false, reason: "empty_token" };
  const platform = Platform.OS === "ios" ? "ios" : "android";
  try {
    await api("/v1/push/register", {
      method: "POST",
      body: JSON.stringify({
        platform,
        token,
        device_name: Device.modelName || Platform.OS,
      }),
    });
    lastRegistered = { platform, token };
    return { enabled: true, reason: "registered_expo" };
  } catch (err) {
    return {
      enabled: false,
      reason: err instanceof Error ? err.message : "register_failed",
    };
  }
}

/** Primary registration: Getui CID for China, Expo fallback. */
export async function registerRemotePush(): Promise<{ enabled: boolean; reason: string }> {
  if (!Device.isDevice) {
    return { enabled: false, reason: "simulator" };
  }
  const ok = await ensureNotificationPermissions();
  if (!ok) {
    return { enabled: false, reason: "permission_denied" };
  }

  const extra = getuiExtra();
  const mod = loadGetuiModule();
  if (mod && (extra.appId || extra.enabled)) {
    try {
      const cid = await waitForClientId(mod);
      await api("/v1/push/register", {
        method: "POST",
        body: JSON.stringify({
          platform: "getui",
          token: cid,
          device_name: Device.modelName || Platform.OS,
        }),
      });
      lastRegistered = { platform: "getui", token: cid };
      return { enabled: true, reason: "registered_getui" };
    } catch (err) {
      // Fall through to Expo so non-China / missing native build still gets something.
      console.warn("[qchat] getui register failed, trying Expo:", err);
    }
  }

  return registerExpoFallback();
}

export async function unregisterRemotePush(): Promise<void> {
  const prev = lastRegistered;
  lastRegistered = null;
  if (!prev?.token) return;
  try {
    await api("/v1/push/unregister", {
      method: "POST",
      body: JSON.stringify({ token: prev.token }),
    });
  } catch {
    /* best-effort on logout */
  }
}

/** @deprecated use registerRemotePush */
export const registerExpoRemotePush = registerRemotePush;
/** @deprecated use unregisterRemotePush */
export const unregisterExpoRemotePush = unregisterRemotePush;
