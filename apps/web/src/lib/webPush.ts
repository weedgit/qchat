import { api } from "@/lib/api";

export type PushDevice = {
  id: string;
  platform: string;
  origin: string;
  device_name: string;
  created_at: string;
  last_seen_at: string;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return "Browser";
}

function pushDeviceName(): string {
  const platform = navigator.platform?.trim();
  return platform ? `${browserName()} on ${platform}` : browserName();
}

/** Register service worker + Web Push subscription (desktop notify via push). */
export async function registerWebPush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const vapid = await api<{ public_key?: string; enabled?: boolean }>("/v1/push/vapid");
  if (!vapid?.enabled || !vapid.public_key) return false;

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") return false;

  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.public_key) as BufferSource,
    });
  }

  await api("/v1/push/register", {
    method: "POST",
    body: JSON.stringify({
      platform: "web",
      subscription: sub.toJSON(),
      origin: window.location.origin,
      device_name: pushDeviceName(),
    }),
  });
  return true;
}

/** Remove this origin's Push subscription but keep the shared PWA service worker. */
export async function unregisterWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  try {
    await api("/v1/push/unregister", {
      method: "POST",
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } finally {
    await sub.unsubscribe().catch(() => false);
  }
  return true;
}

export async function listPushDevices(): Promise<PushDevice[]> {
  const body = await api<{ devices?: PushDevice[] }>("/v1/push/devices");
  return Array.isArray(body?.devices) ? body.devices : [];
}

/** Remove a selected server registration; also unsubscribe if it is this origin. */
export async function removePushDevice(device: PushDevice): Promise<void> {
  await api(`/v1/push/devices/${device.id}`, { method: "DELETE" });
  if (device.origin !== window.location.origin || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => false);
}
