# Qchat — Enterprise Chat Application Delivery Plan

> **Project name:** Qchat (working title). English brand "Qchat"; reserve a Chinese brand (e.g. 快信 / 企信) after trademark and domain checks.

## 1. Recommended Approach

Do not build every requested feature in the first release. Split delivery into a validated prototype, a messaging MVP, and later calling/compliance releases. Real-time calls, five client platforms, unrestricted message inspection, and high-availability recovery materially increase cost and risk.

Recommended product split:

- **Prototype:** validate workflows and visual direction.
- **MVP:** secure registration, enterprise membership, friends, private/group messaging, attachments, notifications, and essential administration.
- **Release 2:** voice messages, forwarding, advanced moderation, desktop packaging, and operational hardening.
- **Release 3:** real-time voice/video calling and advanced compliance controls.

## 2. Decisions Required Before Estimation

Obtain written client answers to the open questions in `requirements-en.md`, especially:

1. First-release platforms and whether desktop can use an Electron/web wrapper.
2. Whether live voice/video calls are in the first commercial release.
3. Required encryption model and whether administrators must read message content.
4. Session rules for phone, web, and desktop devices.
5. SMS verification, supported countries, and push-notification vendors.
6. Allowed attachment formats and size limits.
7. Retention period, deletion rules, backup RPO, and recovery RTO.
8. Measurable concurrency and message-latency targets.
9. Legal/privacy basis for administrators inspecting employee messages.
10. The reference applications and exact prototype scope.

No fixed-price build estimate should be accepted until these decisions are signed off.

## 3. Proposed Technical Architecture

### Client Applications

- **Flutter** for iOS and Android; evaluate Flutter desktop after prototype validation.
- **React/Next.js** for the web chat and administration console.
- Package the web client with **Electron** for the first Windows/macOS release if native desktop behavior is not mandatory.
- Use APNs and FCM, plus required Chinese Android vendor push services when the target distribution region is confirmed.

### Backend

- **Go** services with WebSocket connections for real-time messaging.
- Begin as a modular monolith with clear modules for identity, enterprises, contacts, groups, messaging, files, notifications, and administration. Split services only when measured load or team ownership requires it.
- REST or gRPC for commands/history and WebSocket for live events.
- **PostgreSQL** for accounts, enterprises, memberships, permissions, message metadata, and audit records.
- **Redis** for sessions, presence, CAPTCHA/rate limits, short-lived state, and WebSocket routing.
- S3-compatible object storage for encrypted images, audio, video, and files.
- A durable event broker such as NATS JetStream or Kafka for message fan-out, push notifications, moderation, and asynchronous processing.
- WebRTC with a TURN server for real-time voice/video when that phase begins.

### Security and Operations

- TLS for all network traffic and managed encryption keys for databases, backups, and object storage.
- Argon2id password hashing; passwords are resettable but never viewable.
- Short-lived access tokens with rotating refresh tokens and server-side session/device records.
- Role-based access control and immutable audit logs for sensitive administration.
- Malware scanning, MIME validation, generated download URLs, and image transcoding.
- Metrics for message acceptance, fan-out, delivery acknowledgement, push delivery, WebSocket connections, queue depth, call quality, and errors.
- Automated encrypted backups plus scheduled restore drills.

## 4. Delivery Phases

### Phase 0 — Discovery and Specification (1–2 weeks)

Deliverables:

- Bilingual requirements baseline and glossary
- Answered open-question log
- User roles and permission matrix
- Message state and session/device rules
- Data-retention, privacy, and administrator-access policy
- Capacity model and measurable service-level objectives
- Prioritized release scope and acceptance criteria

Exit criteria:

- Client signs off on scope, exclusions, wireframes, platform targets, and security model.

### Phase 1 — UX Prototype (2–3 weeks)

Prototype these flows:

- Registration, invitation code, CAPTCHA, and login
- Conversation list and one-to-one chat
- Group creation, join approval, member management, mentions, mute, and recall
- Profile and friend privacy settings
- File/image sending and message actions
- Administration dashboards and high-risk action confirmations

Exit criteria:

- Client approves the interaction model and visual reference.
- Prototype does not imply that backend, encryption, calls, or scalability are already implemented.

### Phase 2 — Foundation (3–5 weeks)

Build:

- Environments, CI/CD, database migrations, secrets, logging, metrics, and alerts
- Enterprise, account, invitation, login, session, and device models
- Password hashing, CAPTCHA, rate limiting, and role-based authorization
- Base Flutter app, web app, and administrator console
- Audit-event framework and backup automation

Exit criteria:

- Users can securely register, join the correct enterprise, sign in, remain signed in according to the session policy, and be remotely signed out.

### Phase 3 — Core Messaging MVP (5–8 weeks)

Build:

- Friend requests, privacy modes, aliases, tags, and presence
- Conversation list and history pagination
- One-to-one and group text messaging over WebSocket
- Ordered client-generated message IDs, idempotent sends, retries, and acknowledgements
- Sent/delivered/read states
- Group membership, roles, join review, mentions, quoted replies, recall, mute, kick, and leave behavior
- New-member history boundary
- Offline synchronization and mobile push notifications

Exit criteria:

- No duplicate messages during reconnect/retry tests.
- Authorization tests prove enterprise and group isolation.
- The agreed percentile of online message deliveries meets the sub-one-second target under the agreed load.

### Phase 4 — Media and Message Actions (3–5 weeks)

Build:

- Image, GIF, document, recorded voice, and video-file upload
- Size/type policy, multipart upload, thumbnails, antivirus scanning, and secure download
- Copy, forward, multi-target forward, and attachment retention
- Voice recording up to 60 seconds
- Storage quotas and administration controls

Exit criteria:

- Unsupported or malicious files are rejected or quarantined.
- Interrupted uploads can safely retry.
- Retention jobs cover both messages and associated files.

### Phase 5 — Administration and Compliance (3–5 weeks)

Build:

- Platform-owner and enterprise-admin subaccounts
- User, enterprise, group, session, device, invitation, and ban management
- Secure assisted registration and password reset
- Registration IP and coarse geolocation display with retention controls
- Audited message-search/access workflow if legally approved
- Moderation queue, reports, exports, retention policies, and legal hold if required
- Audit-log search and export

Exit criteria:

- Every sensitive action records actor, target, reason, time, result, and source IP.
- No role can retrieve a user's existing password.
- Cross-enterprise access is denied unless an explicitly audited platform-compliance role is authorized.

### Phase 6 — Calls (Optional, 4–8 weeks)

Build:

- One-to-one voice and video calls using WebRTC
- Signaling, STUN/TURN, ringing, timeout, reconnect, call history, and push wake-up
- Permission handling, network adaptation, and quality telemetry
- Define separately whether group calls, recording, screen sharing, or end-to-end media encryption are required

Exit criteria:

- Call setup and quality pass tests on supported devices and weak/mobile networks.

### Phase 7 — Hardening and Launch (3–5 weeks)

Complete:

- Load, soak, failover, backup-restore, penetration, and mobile background-delivery tests
- Security and privacy review
- App Store/Play Store and desktop signing/release work
- Operational runbooks, incident response, support procedures, and monitoring dashboards
- Staged rollout with rollback criteria

Exit criteria:

- Demonstrated capacity above the contracted concurrency target.
- Restore drill meets the contracted RPO/RTO.
- No unresolved critical security findings.

## 5. MVP Scope Recommendation

Include:

- iOS, Android, and responsive web
- Enterprise invitation and secure login
- Profiles, friend relationships, and presence
- One-to-one and 1,000-member group chat
- Text, built-in emoji, stickers, GIFs, images, files, recorded voice, and uploaded video
- Mentions, quoted replies, forwarding, recall, mute, read states, and push notifications
- Essential enterprise and platform administration
- Three-month configurable retention, audit logs, backups, and monitoring

Defer:

- Live voice/video calls
- Fully native Windows/macOS clients
- Group calling, screen sharing, and call recording
- End-to-end encryption
- Advanced legal hold/eDiscovery
- Nonessential social features beyond stickers/GIFs

## 6. Quality and Acceptance Strategy

- Unit tests for authorization, permissions, message state, session rules, and retention.
- Integration tests for database, Redis, object storage, queues, and push adapters.
- End-to-end tests for registration, private chat, group workflows, reconnect, offline sync, and administration.
- Contract tests to keep mobile/web clients compatible with backend APIs.
- Load tests covering at least the contracted concurrent connections, group fan-out, reconnect storms, and attachment traffic.
- Security tests for tenant isolation, ID enumeration, upload attacks, token replay, privilege escalation, and administrator auditing.
- Recovery tests that restore production-like encrypted backups into an isolated environment.
- Mobile tests for background restrictions and push delivery across supported OS/vendor combinations.

## 7. Indicative Team and Schedule

Suggested core team:

- 1 product manager/business analyst with Chinese support
- 1 product designer
- 2 backend engineers
- 2 client engineers
- 1 web/admin engineer
- 1 QA automation engineer
- Part-time DevOps/SRE and security support

With decisions made promptly and live calling deferred, a production-ready MVP is roughly **4–6 months** for this team. A prototype alone is roughly **2–3 weeks**. Live calls, native desktop applications, extensive compliance tooling, or unclear approval cycles can extend the schedule substantially. These ranges are planning guidance, not a fixed quote.

## 8. Immediate Next Steps

1. Send the English requirements and open questions to the client for confirmation.
2. Produce a bilingual permission matrix for platform owner, enterprise admin, group owner, group admin, and member.
3. Agree on MVP inclusions/exclusions and measurable acceptance criteria.
4. Create wireframes for the critical flows.
5. Run a technical proof of concept for WebSocket reconnect/order, 1,000-member group fan-out, and vendor push delivery.
6. Convert the approved scope into epics, user stories, estimates, and a milestone contract.
