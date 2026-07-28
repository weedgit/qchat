/**
 * Notification port for mobile messaging.
 *
 * Current backend: local OS banners while the app process is alive (WS-driven).
 * Remote push (FCM / APNs / Expo Push) is intentionally deferred — registerRemote /
 * unregisterRemote are no-ops so messaging features do not depend on push adapters.
 *
 * Do not expose unsupported remote-push toggles as functional in the UI.
 */

import {
  attachNotificationResponseListener,
  ensureNotificationPermissions,
  presentMessageNotification,
  type LocalMessageNotify,
} from "./localNotify";

export type MessageNotifyPayload = LocalMessageNotify;

export type NotificationPort = {
  /** Present a foreground / in-process message banner. */
  presentForegroundMessage: (opts: MessageNotifyPayload) => Promise<void>;
  /** Request local notification permission (not remote push). */
  ensureLocalPermission: () => Promise<boolean>;
  /** Navigate when the user taps a local notification. */
  attachTapListener: () => () => void;
  /**
   * Register for remote push. Deferred — always resolves without contacting the server.
   * Future FCM/APNs/Expo backends can implement this without changing chat call sites.
   */
  registerRemote: () => Promise<{ enabled: boolean; reason: string }>;
  /** Unregister remote push. Deferred no-op. */
  unregisterRemote: () => Promise<void>;
};

const localBackend: NotificationPort = {
  presentForegroundMessage: presentMessageNotification,
  ensureLocalPermission: ensureNotificationPermissions,
  attachTapListener: attachNotificationResponseListener,
  async registerRemote() {
    return { enabled: false, reason: "remote_push_deferred" };
  },
  async unregisterRemote() {
    /* remote push not enabled */
  },
};

/** Active notification implementation (swap later for FCM/Expo without touching ChatContext). */
export const notificationPort: NotificationPort = localBackend;
