# Push notifications

Qchat delivers push through configured adapters only. Registration may accept more platforms than can currently send.

## Delivery order

| Priority | Adapter | Client token | Server env |
|----------|---------|--------------|------------|
| 1 | Web Push (VAPID) | Browser PushSubscription JSON | `QCHAT_VAPID_*` |
| 2 | Expo Push | `ExponentPushToken[...]` on `ios`/`android` | `QCHAT_EXPO_PUSH_ENABLED` (default on), optional `QCHAT_EXPO_ACCESS_TOKEN` |
| 3 | Native FCM HTTP v1 | FCM registration token (`android`) | `QCHAT_FCM_PROJECT_ID`, `QCHAT_FCM_CREDENTIALS_JSON` |
| 4 | Native APNs HTTP/2 | Hex device token (`ios`) | `QCHAT_APNS_*` |

Expo apps should register Expo tokens. The API routes Expo-shaped tokens through Expo Push even when `platform` is `ios`/`android`.

## Register / unregister

- `POST /v1/push/register` — `{ platform, token | subscription, device_name?, origin? }`
- Response `adapters` lists **enabled send backends only** (honest).
- `oem_deferred`: `huawei`, `xiaomi`, `oppo`, `vivo` — tokens may be stored; **no send yet**.
- `POST /v1/push/unregister` — remove by token/subscription.
- Stale endpoints (HTTP 404/410 from providers) are deleted automatically.

## Mobile client

`apps/mobile` calls `notificationPort.registerRemote()` after sign-in / WS connect and unregisters on sign-out. Implementation: `src/lib/remotePush.ts` (Expo Notifications).

Set `EAS_PROJECT_ID` (or `extra.eas.projectId`) so `getExpoPushTokenAsync` works in release builds.

## OEM (deferred)

China OEM vendor SDKs are out of scope for this pass. Do not advertise them as live adapters until each channel is implemented and credentialed.

## Secrets

Never commit VAPID private keys, FCM service-account JSON, APNs `.p8` files, or Expo access tokens. Use `deploy/qchat-api.env` (gitignored) and EAS secrets.
