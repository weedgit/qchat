/**
 * Notification port for mobile messaging.
 *
 * - Foreground / in-process banners: local OS notifications (WS-driven).
 * - Remote push: Expo Push tokens registered with the API (FCM/APNs via Expo).
 *   OEM vendor SDKs (Huawei/Xiaomi/OPPO/vivo) remain deferred on the server.
 */

import {
  attachNotificationResponseListener,
  ensureNotificationPermissions,
  presentMessageNotification,
  type LocalMessageNotify,
} from "./localNotify";
import { registerExpoRemotePush, unregisterExpoRemotePush } from "./remotePush";

export type MessageNotifyPayload = LocalMessageNotify;

export type NotificationPort = {
  /** Present a foreground / in-process message banner. */
  presentForegroundMessage: (opts: MessageNotifyPayload) => Promise<void>;
  /** Request local notification permission (not remote push). */
  ensureLocalPermission: () => Promise<boolean>;
  /** Navigate when the user taps a local notification. */
  attachTapListener: () => () => void;
  /** Register Expo push token with the API. */
  registerRemote: () => Promise<{ enabled: boolean; reason: string }>;
  /** Unregister the last Expo push token from the API. */
  unregisterRemote: () => Promise<void>;
};

const localBackend: NotificationPort = {
  presentForegroundMessage: presentMessageNotification,
  ensureLocalPermission: ensureNotificationPermissions,
  attachTapListener: attachNotificationResponseListener,
  registerRemote: registerExpoRemotePush,
  unregisterRemote: unregisterExpoRemotePush,
};

/** Active notification implementation. */
export const notificationPort: NotificationPort = localBackend;
