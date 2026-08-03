# Push notifications (China mainland)

Qchat targets **Chinese mainland** devices. Background / killed-app delivery uses **个推 (Getui)** as the aggregator for manufacturer channels (Huawei / Xiaomi / OPPO / vivo / Honor). Expo / FCM remain optional fallbacks.

## Delivery order

| Priority | Adapter | Client token | Server env |
|----------|---------|--------------|------------|
| 1 | Web Push (VAPID) | Browser PushSubscription JSON | `QCHAT_VAPID_*` |
| 2 | **Getui 个推** | ClientID (`platform: getui`) | `QCHAT_GETUI_APP_ID`, `QCHAT_GETUI_APP_KEY`, `QCHAT_GETUI_MASTER_SECRET` |
| 3 | Expo Push | `ExponentPushToken[...]` on `ios`/`android` | `QCHAT_EXPO_PUSH_ENABLED`, optional `QCHAT_EXPO_ACCESS_TOKEN` |
| 4 | Native FCM / APNs | Device tokens | `QCHAT_FCM_*` / `QCHAT_APNS_*` |

OEM platforms `huawei` / `xiaomi` / `oppo` / `vivo` / `honor` / `meizu` are accepted on register and **sent via Getui** when Getui is configured (CID from the Getui SDK).

## Getui console checklist

1. Create an app at [dev.getui.com](https://dev.getui.com) → copy AppID / AppKey / MasterSecret / AppSecret.
2. Enable **多厂商** (manufacturer) channels: Huawei HMS, Xiaomi, OPPO, vivo, Honor (and Meizu if needed). Upload each vendor’s credentials in the Getui console.
3. Put server secrets in `deploy/qchat-api.env` (never commit):
   ```
   QCHAT_GETUI_APP_ID=...
   QCHAT_GETUI_APP_KEY=...
   QCHAT_GETUI_MASTER_SECRET=...
   ```
4. Put client AppID / AppKey / AppSecret in the mobile build env:
   ```
   EXPO_PUBLIC_GETUI_APP_ID=...
   EXPO_PUBLIC_GETUI_APP_KEY=...
   EXPO_PUBLIC_GETUI_APP_SECRET=...
   ```
5. Rebuild the native app (`npx expo prebuild` + Android/iOS build, or EAS). Getui requires a **dev client / release APK**, not Expo Go.

## Register / unregister

- `POST /v1/push/register` — `{ platform, token | subscription, device_name?, origin? }`
- `platform`: `web` | `ios` | `android` | `getui` | `huawei` | `xiaomi` | `oppo` | `vivo` | `honor` | `meizu`
- Response `adapters` lists **enabled send backends**. When Getui is on, response includes `oem_via: "getui"`.
- `POST /v1/push/unregister` — remove by token.
- Stale endpoints (HTTP 404/410 / Getui invalid CID) are deleted automatically.

## Mobile client

`apps/mobile` calls `notificationPort.registerRemote()` after sign-in / WS connect:

1. Prefer **Getui CID** via `react-native-getui` + `plugins/withGetui.js`.
2. Fall back to Expo Push if the native module is missing or CID times out.

## Secrets

Never commit Getui MasterSecret, VAPID private keys, FCM service-account JSON, or APNs `.p8` files. Use `deploy/qchat-api.env` (gitignored) and EAS secrets for client AppID/AppKey/AppSecret.
