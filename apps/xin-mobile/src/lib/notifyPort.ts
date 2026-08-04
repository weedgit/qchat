/**
 * Notification port for mobile messaging.
 *
 * - Foreground / in-process banners: local OS notifications (WS-driven).
 * - Remote push (China mainland): 个推 Getui CID → API → OEM channels
 *   (Huawei / Xiaomi / OPPO / vivo / Honor when enabled in Getui console).
 * - Fallback: Expo Push (FCM/APNs) when Getui native module is unavailable.
 */

import {
  attachNotificationResponseListener,
  ensureNotificationPermissions,
  presentMessageNotification,
  type LocalMessageNotify,
} from "./localNotify";
import { registerRemotePush, unregisterRemotePush } from "./remotePush";

export type MessageNotifyPayload = LocalMessageNotify;

export type NotificationPort = {
  /** Present a foreground / in-process message banner. */
  presentForegroundMessage: (opts: MessageNotifyPayload) => Promise<void>;
  /** Request local notification permission (not remote push). */
  ensureLocalPermission: () => Promise<boolean>;
  /** Navigate when the user taps a local notification. */
  attachTapListener: () => () => void;
  /** Register Getui/Expo push token with the API. */
  registerRemote: () => Promise<{ enabled: boolean; reason: string }>;
  /** Unregister the last remote push token from the API. */
  unregisterRemote: () => Promise<void>;
};

const localBackend: NotificationPort = {
  presentForegroundMessage: presentMessageNotification,
  ensureLocalPermission: ensureNotificationPermissions,
  attachTapListener: attachNotificationResponseListener,
  registerRemote: registerRemotePush,
  unregisterRemote: unregisterRemotePush,
};

/** Active notification implementation. */
export const notificationPort: NotificationPort = localBackend;
