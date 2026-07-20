/**
 * Auth device fields for session policy (phone vs desktop).
 * Browser and Electron both use device_type=desktop; device_name distinguishes them.
 */
export function getAuthDevice(): { deviceType: "desktop" | "phone"; deviceName: string } {
  if (typeof window !== "undefined") {
    const desk = window.qchatDesktop;
    if (desk?.isDesktop) {
      return {
        deviceType: "desktop",
        deviceName: desk.deviceName || `Qchat Desktop (${desk.platform || "unknown"})`,
      };
    }
  }
  return { deviceType: "desktop", deviceName: "web" };
}

export function isQchatDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.qchatDesktop?.isDesktop);
}
