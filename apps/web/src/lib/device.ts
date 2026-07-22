/**
 * Auth device fields for session policy.
 * device_id is a stable per-install id (localStorage); sessions and call
 * signaling are scoped to it so multi-device logins stay independent.
 */

const DEVICE_ID_KEY = "qchat.device_id";

/** Stable device id for this browser profile / Electron install. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Browser and Electron both use device_type=desktop; device_name distinguishes them.
 * device_id uniquely identifies this client install for sessions + calls.
 */
export function getAuthDevice(): {
  deviceType: "desktop" | "phone";
  deviceName: string;
  deviceId: string;
} {
  const deviceId = getDeviceId();
  if (typeof window !== "undefined") {
    const desk = window.qchatDesktop;
    if (desk?.isDesktop) {
      return {
        deviceType: "desktop",
        deviceName: desk.deviceName || `Qchat Desktop (${desk.platform || "unknown"})`,
        deviceId,
      };
    }
  }
  return { deviceType: "desktop", deviceName: "web", deviceId };
}

export function isQchatDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.qchatDesktop?.isDesktop);
}
