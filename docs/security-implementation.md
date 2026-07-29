# Qchat Security Implementation

This document describes **how security is implemented in code and deployment**, not product aspirations. For launch checklists see [`HARDENING.md`](./HARDENING.md) and [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md). For product decisions see [`qchat-security-decisions.md`](./qchat-security-decisions.md).

---

## 1. Threat model and encryption posture

| Layer | What Qchat does |
|---|---|
| **In transit** | TLS at the reverse proxy (`deploy/nginx-qchat.conf`: TLSv1.2/1.3). The Go API listens on plain HTTP (`:8080`) behind nginx. |
| **At rest (passwords)** | bcrypt hashes only — never recoverable or returned by APIs. |
| **At rest (messages / media)** | Stored server-side so **enterprise admins can inspect** with reason + audit. **Not end-to-end encrypted.** |
| **Calls** | LiveKit SFU issues short-lived join tokens; media is not E2EE. |
| **Tokens / OTP / recovery** | Refresh tokens, SMS codes, and MFA recovery codes are stored as **SHA-256 hashes**. |

Explicit non-goal: end-to-end encryption (compliance inspection requires server-readable bodies).

---

## 2. Authentication

**Primary code:** `services/api/internal/server/auth_handlers.go`, `services/api/internal/auth/`

### Sign-in factors

1. **Phone** (11-digit) + **password**
2. **CAPTCHA** on login, register, and OTP request (`GET /v1/auth/captcha`)
3. **SMS OTP** on self-service register (`POST /v1/auth/register/otp`, then register with `sms_challenge_id` / `sms_code`)
4. **Company invite code** on register (revocable/rotatable by admin)
5. **Admin MFA** (TOTP or recovery code) when the account has MFA active

### Passwords

| Rule | Implementation |
|---|---|
| Policy | ≥ 8 characters; letters and/or digits only (`auth.ValidatePassword`) |
| Hash | bcrypt (`auth.HashPassword` / `CheckPassword`, `bcrypt.DefaultCost`) |
| Recovery | No end-user reset; **admin reset only** (never returns the old password) |

> Note: older decision docs mention Argon2id; the running code uses **bcrypt**.

### Access and refresh tokens

| Token | Lifetime (default) | Storage / format |
|---|---|---|
| Access JWT | `QCHAT_ACCESS_TTL` → **15 minutes** | HS256; claims include `uid`, `eid`, `role`, `sid`, `dtype`, `did` |
| Refresh | `QCHAT_REFRESH_TTL` → **60 days** | 32 random bytes (hex); only **SHA-256 hash** stored in `sessions.refresh_hash` |

**Refresh rotation:** each refresh issues a new session and revokes the old one. Reuse of a revoked/expired refresh token triggers **revoke-all** for that user (`refresh_reused`).

**Remember me:** if the client does not opt in, the API returns an empty `refresh_token` so the client cannot persist long-lived refresh (the session row may still exist with the configured TTL).

### CAPTCHA and SMS

- Captcha rows expire in ~5 minutes and are single-use (`consumeCaptcha`).
- Non-production captcha responses may include `dev_answer`.
- SMS codes: 6 digits, hashed, ~10 minute TTL, max **5 attempts**.
- Provider `QCHAT_SMS_PROVIDER=dev` logs/returns `dev_code` locally — **refused when `QCHAT_ENV=production`**.

### Client credential storage

| Client | Where tokens live |
|---|---|
| Web | `localStorage` (remember) or `sessionStorage` |
| Admin | Access token in local/session storage |
| Desktop | Electron `safeStorage` vault (`apps/desktop/src/main/secureStorage.js`), with web storage sync |
| Mobile | Expo Secure Store (`apps/mobile/src/lib/api.ts`) |

---

## 3. Sessions and device policy

**Rule:** at most **one web**, **one desktop**, and **one phone** session per user.

On login/register, `revokeSameTypeSessions` (`session_revoke.go`) revokes prior sessions of the same `device_type`. Affected clients receive WebSocket `session.revoked` (reasons include `replaced`, `logout`, `revoked`, `banned`, `password_reset`, `admin_revoked`) and subsequent API calls fail.

**Immediate kill of access JWTs:** revoked session IDs are tracked in-process and in Redis (`qchat:revoked:{id}`, ~24h). Auth middleware and the WebSocket handshake reject revoked `sid` values.

**Self-service:** `GET` / `DELETE /v1/me/sessions/{id}`  
**Admin:** list/revoke with mandatory reason (≥ 8 characters).

---

## 4. Authorization and tenancy

### End users

- Conversations, media, friends, and groups are scoped by membership and **`enterprise_id`**.
- Cross-tenant IDOR is treated as a launch risk — see checks in [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md).

### Admin console RBAC

Permissions are enforced with `requirePerm` on the API (`admin_rbac.go`), mirrored in `apps/admin/src/lib/rbac.ts`.

| Permission | platform_owner | enterprise_admin | compliance | support | read_only |
|---|:---:|:---:|:---:|:---:|:---:|
| `admin.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `admin.messages.inspect` | ✓ | ✓ | ✓ | | |
| `admin.users.create_member` | ✓ | ✓ | | ✓ | |
| `admin.users.create_console_role` | ✓ | ✓ | | | |
| `admin.users.reset_password` | ✓ | ✓ | | ✓ | |
| `admin.users.revoke_session` | ✓ | ✓ | | ✓ | |
| `admin.users.ban` | ✓ | ✓ | | | |
| `admin.invite.manage` | ✓ | ✓ | | | |
| `admin.enterprise.write` | ✓ | ✓ | | | |
| `admin.security.write` | ✓ | ✓ | | | |
| `admin.retention` | ✓ | ✓ | | | |
| `admin.issue_enterprise_admin` | ✓ | | | | |

Most admin writes are scoped to the admin’s `enterprise_id`. Platform owners can operate across enterprises where the handler allows it.

JWT `role` is stamped at session issue from `users.role` — role changes take effect after re-login/refresh.

Product-level capability table (groups/channels): [`qchat-permission-matrix.md`](./qchat-permission-matrix.md).

---

## 5. Admin security controls

| Control | Behavior |
|---|---|
| **MFA (TOTP)** | Admin-only setup/activate; RFC-style TOTP (30s, ±1 skew) + hashed recovery codes |
| **IP allowlist** | `admin_ip_allowlist`; empty = disabled; enforced at login for admin roles |
| **Login alerts** | New device/IP for admins written to audits |
| **Message inspect** | `GET /v1/admin/messages` requires **reason ≥ 8 chars**; membership-scoped; writes `audit_logs` |
| **Ban** | Sets banned; revokes sessions (`banned`); login/refresh refuse banned users |
| **Password reset** | Reason required; clears MFA/recovery; revokes all sessions; never returns old password |
| **Audits** | Immutable `audit_logs`; query via `GET /v1/admin/audits` |

UI: Admin **Security** page (MFA + allowlist) and login MFA challenge.

---

## 6. Transport, CORS, and WebSockets

| Concern | Implementation |
|---|---|
| TLS | Nginx terminates HTTPS (443) and LiveKit TLS (7443); HTTP redirects to HTTPS |
| CORS | `QCHAT_CORS_ORIGIN` (`*`, single origin, or comma list); localhost helpers for local web/admin |
| REST auth | `Authorization: Bearer <access_jwt>` |
| WebSocket | `GET /v1/ws` with `?token=` or Bearer; `CheckOrigin` follows CORS; empty Origin allowed for native clients |
| Media GET | Bearer or `?token=` (for `<img>` tags) |
| Metrics | Prometheus `/metrics` — **not** exposed on public nginx (404) |

---

## 7. Rate limiting and abuse controls

### API (`rate_limit.go`; skipped when `Env=test`)

| Scope | Limit (approx.) |
|---|---|
| Auth endpoints | ~5/min, burst 10 |
| General API | 30/s, burst 60 |
| WebSocket connect | 10/min, burst 20 |
| Login lockout | 5 failures per phone+IP → **15 minutes** locked |

### Edge

Nginx `limit_req` zones for auth / API / WS (`deploy/nginx-qchat.conf`).

### Input hygiene

- Phone `^\d{11}$`
- Username / display-name Unicode rules
- JSON decode with `DisallowUnknownFields` on sensitive bodies
- LIKE escaping on admin search
- Path traversal rejected on media get

---

## 8. Media and uploads

**Handlers:** `media_collab_handlers.go`

| Kind | Size cap | Content rules |
|---|---|---|
| Avatar | 100 MB | MIME whitelist: JPEG/PNG/GIF/WebP; reject `.svg` |
| Image / file | 100 MB | Content-Type accepted broadly (unknown MIME rejected for some paths) |
| Video | 200 MB | |
| Voice | 10 MB | |

- Multipart memory ~32 MB; body limited with `io.LimitReader`
- Objects stored in MinIO/S3 when configured, else `QCHAT_DATA_DIR/uploads`
- Object keys must start with `{enterprise_id}/` or `personal/{user_id}/`
- Nginx `client_max_body_size 210m`
- `media_objects.scanned` exists but **no malware scanner** is wired yet

---

## 9. Calls (LiveKit)

- API mints join tokens (`services/api/internal/livekit/token.go`) with room join/publish/subscribe grants (~1 hour TTL).
- Clients receive `livekit_url` + `livekit_token` from call handlers.
- Default dev key/secret (`devkey` / long default secret) are **refused in production**.

---

## 10. Push notifications

| Channel | Secrets / notes |
|---|---|
| Web Push (VAPID) | `QCHAT_VAPID_*`; public key via `GET /v1/push/vapid`; register requires auth |
| Expo | `QCHAT_EXPO_PUSH_ENABLED`, optional access token |
| FCM / APNs | Project/credentials / key material via env |

Dev VAPID defaults exist for local use only — rotate for production. Details: [`push.md`](./push.md).

---

## 11. Production secret guards

On startup, when `QCHAT_ENV=production`, `Config.ValidateSecrets()` (`services/api/internal/config/config.go`) **exits** unless:

1. `QCHAT_JWT_SECRET` is unique, not the default, and ≥ 32 characters  
2. `QCHAT_SMS_PROVIDER` is a real gateway (`twilio` / `aliyun` / `router`) with credentials — not `dev`  
3. LiveKit URL/key/secret are set and not the packaged defaults; secret ≥ 32 characters  

Ops helpers:

- `deploy/check-env.sh`
- `deploy/rotate-jwt-secret.sh`
- `deploy/render-media-config.sh --strict`
- Wired into `deploy/redeploy.sh` (`--require-media`)

Example env template: `deploy/qchat-api.env.example`.

---

## 12. Desktop and mobile hardening

### Desktop (Electron)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Token vault via Electron `safeStorage` (filesystem fallback mode `0600` if OS crypto unavailable)
- Certificate trust dialog + persisted trust for self-signed hosts
- Deep links and notifications do not bypass session auth

### Mobile

- Access/refresh tokens, device id, and prefs in **Expo Secure Store**
- Session-revoke reasons surfaced on the login screen when kicked

---

## 13. Data retention and backups

- Default retention **90 days**, configurable per enterprise (`retention_days`)
- API retention loop + `POST /v1/admin/retention/run`
- SQL helper: `deploy/retention.sql`
- Backup / restore: `deploy/backup.sh`, `deploy/restore.sh`, drill notes in [`RESTORE_DRILL.md`](./RESTORE_DRILL.md)

---

## 14. Key environment variables

| Variable | Purpose |
|---|---|
| `QCHAT_ENV` | Enables production secret refusal when `production` |
| `QCHAT_JWT_SECRET` | HS256 signing key for access tokens |
| `QCHAT_ACCESS_TTL` / `QCHAT_REFRESH_TTL` | Token lifetimes |
| `QCHAT_CORS_ORIGIN` | Browser/WebSocket origin policy |
| `QCHAT_SMS_PROVIDER` / `QCHAT_SMS_*` | OTP gateway |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Call token minting |
| `QCHAT_OBJECT_STORAGE_*` / `QCHAT_BUCKET` / `QCHAT_DATA_DIR` | Blob storage |
| `QCHAT_VAPID_*` | Web Push |
| `QCHAT_EXPO_*` / `QCHAT_FCM_*` / `QCHAT_APNS_*` | Mobile push |
| `QCHAT_DATABASE_URL` / `QCHAT_REDIS_URL` | Postgres; Redis for revoke markers + multi-node WS fan-out |

Loader: `services/api/internal/config/config.go`.

---

## 15. Known limitations (honest)

These are accepted or documented risks for current builds:

1. **No E2EE** — messages and attachments are readable by the server and by authorized admins under audit.
2. **CAPTCHA** may return a plaintext/dev challenge in non-production; replace with stronger CAPTCHA for internet-facing prod.
3. **Dev SMS** must never ship in production (guarded by `ValidateSecrets`).
4. **Default CORS `*`** and default VAPID keys are for local/dev only.
5. **Chat attachment MIME** is less strict than avatar MIME allowlisting.
6. **REST auth** rejects revoked sessions via JWT `sid` + revoke markers; it does not re-query `banned` on every request — bans rely on session kick at ban time.
7. **TLS** is an ops responsibility (nginx/certs); the API process itself speaks HTTP.

---

## Related files

| Area | Path |
|---|---|
| Auth handlers | `services/api/internal/server/auth_handlers.go` |
| Password / captcha / TOTP | `services/api/internal/auth/` |
| Session revoke | `services/api/internal/server/session_revoke.go` |
| Admin RBAC | `services/api/internal/server/admin_rbac.go` |
| Rate limits | `services/api/internal/server/rate_limit.go` |
| Config / production guards | `services/api/internal/config/config.go` |
| Nginx TLS + rate limits | `deploy/nginx-qchat.conf` |
| Desktop vault | `apps/desktop/src/main/secureStorage.js` |
| Admin UI RBAC | `apps/admin/src/lib/rbac.ts` |
