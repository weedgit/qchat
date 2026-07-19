# Qchat Mobile (Flutter)

Native iOS/Android clients against the same REST + WebSocket contracts as web.

## Bootstrap

```bash
# Requires Flutter SDK
flutter create --org com.qchat --project-name qchat_mobile .
flutter pub get
```

## Planned packages

- `dio` / `http` — REST
- `web_socket_channel` — realtime
- `flutter_secure_storage` — tokens
- `firebase_messaging` + OEM adapters (Huawei/Xiaomi/OPPO/vivo) for push
- `livekit_client` — voice/video calls (Phase 6)

## API

- Base URL configurable (LAN IP for devices; not localhost)
- Auth: `/v1/auth/*`
- Messaging: `/v1/conversations`, `/v1/ws`
- Push register: `POST /v1/push/register` with platform `ios|android|huawei|xiaomi|oppo|vivo`

## Session policy

Phone device type replaces previous phone session; desktop sessions remain.
