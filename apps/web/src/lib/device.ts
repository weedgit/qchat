/**
 * Auth device fields for session policy.
 *
 * device_type is one of: web | desktop | phone — at most one active session
 * per type per user (new login of the same type revokes the previous).
 * device_id is a stable per-install id for call signaling (initiator/answerer).
 * platform is a human label for Settings → active sessions.
 */

import { detectDesktopPlatform, detectWebPlatform } from "./clientPlatform";
import { newUUID } from "./uuid";

const DEVICE_ID_KEY = "qchat.device_id";

export type AuthDeviceType = "web" | "desktop" | "phone";

/** Stable device id for this browser profile / Electron install. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = newUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return newUUID();
  }
}

/**
 * Classify this client for the one-web / one-desktop / one-phone session policy.
 */
export async function getAuthDevice(): Promise<{
  deviceType: AuthDeviceType;
  deviceName: string;
  deviceId: string;
  platform: string;
}> {
  const deviceId = getDeviceId();
  if (typeof window !== "undefined") {
    const desk = window.qchatDesktop;
    if (desk?.isDesktop) {
      const info = detectDesktopPlatform();
      return {
        deviceType: "desktop",
        deviceName: desk.deviceName || `Qchat Desktop (${desk.platform || "unknown"})`,
        deviceId,
        platform: info.platform,
      };
    }
  }
  const info = await detectWebPlatform();
  return {
    deviceType: "web",
    deviceName: info.browser || info.platform || "web",
    deviceId,
    platform: info.platform,
  };
}

export function isQchatDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.qchatDesktop?.isDesktop);
}
