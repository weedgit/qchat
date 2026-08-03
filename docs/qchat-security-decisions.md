# Qchat Security & Product Decisions (Phase 0)

Working defaults until the client signs a formal change order. Documented so engineering can proceed.

| Topic | Decision |
|---|---|
| Project name | **Qchat** |
| Build approach | Independent greenfield (no fork) |
| UI style | Simple, focused messenger; collaboration controls in secondary panels |
| First client | Responsive web + admin console |
| Auth | Phone (11-digit CN) + password; graphical CAPTCHA on login |
| SMS OTP | Optional in MVP; phone format validated; OTP adapter stubbed |
| Invite codes | Permanent & reusable by default; admin can revoke/rotate |
| Sessions | At most **one web**, **one desktop**, and **one phone** session. Same-type login replaces the previous. Calls route media by **device_id** (initiator/answerer). |
| Remember me | Refresh token up to 60 days |
| Password storage | Argon2id; never recoverable/viewable |
| Password recovery | None for end users; admin reset only |
| Encryption | TLS in transit + encryption at rest for DB/files; not E2EE (admin inspection required) |
| Admin message access | Role-gated, reason required, immutable audit |
| Read receipts | Full sent/delivered/read for DMs; per-member read/unread lists for groups when the conversation is opened |
| Retention | Default 90 days minimum, configurable per enterprise |
| Avatar max | Soft-cap 5 MB processed; reject absurd 100 MB uploads with clear error (client asked 100 MB — product defaults to sensible limit with config override) |
| Attachments | Images jpg/png/gif/webp ≤ 20 MB; docs ≤ 50 MB; video ≤ 200 MB; voice ≤ 60 s |
| Latency SLO | p95 < 1s for online same-region delivery under contracted load |
| Concurrency | ≥ 1,000 concurrent WebSocket connections in MVP acceptance |
| Backup | Daily encrypted Postgres + MinIO + uploads; optional secrets; off-site rsync; RPO ≤ 24h, RTO ≤ 4h (MVP) |
| Push | Web push first; APNs/FCM/OEM adapters defined before mobile |
| Calls | LiveKit + TURN in Phase 6; not in Messenger MVP |

## Explicit non-goals for Messenger MVP

- End-to-end encryption
- Full boards/playbooks
- Native mobile/desktop stores
- Group video calling / screen share
