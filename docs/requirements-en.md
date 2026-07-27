# Enterprise Internal Instant Messaging Platform Requirements

> English translation of the client's Chinese requirements. Ambiguous items are retained and listed under “Open Questions” rather than silently reinterpreted.

## 1. Product Overview

Build an enterprise internal instant messaging product for small teams.

A project member should be able to mention (`@`) another member in a group so that the recipient notices the message promptly. The product must include:

- One-to-one private chat
- Group chat
- Conversation/message list
- File and image transfer
- Sent, read, and unread message states
- Video and voice calls
- Message delivery latency below one second
- More than 1,000 concurrent online users
- Encrypted message transport
- A prototype comparable to other social messaging applications

## 2. Client Application Requirements

### 2.1 Registration and Login

- Register with a mobile phone number.
- A user joins a company's internal chat using that company's invitation code.
- Each company has its own invitation code. Company A's and Company B's codes are permanently valid and reusable.
- Registration requires an 11-digit mobile number.
- Login requires a graphical CAPTCHA to prevent automated abuse.
- A phone and a computer may remain signed in at the same time.
- When another device of the same type signs in, the previous device should be signed out. **Confirmed:** at most one `web`, one `desktop`, and one `phone` session; same-type login replaces the previous (`revokeSameTypeSessions` + `session.revoked`).
- “Remember my password/login” should keep the user signed in for up to 60 days.
- Users can sign in with a password.
- Passwords must contain only digits, or a combination of letters and digits, and must be at least eight characters long (for example, `12345678` or `abc123456`).
- No self-service password recovery is required.

### 2.2 User Profile

Users can edit:

- Avatar
- Unique display name/username
- Real name
- Age
- Region
- Personal status/signature

Profile visibility can be set to public or friends-only.

- Avatar formats should include JPG, PNG, and GIF, with more formats preferred.
- Maximum avatar file size: 100 MB.
- Names must be unique.
- Special symbols are not allowed in names, but emoji are allowed.

### 2.3 Groups and Friends

Friends can create a group and invite any same-tenant users (friendship not required). Users can also find a group by its group ID and request to join. A group owner or administrator must approve membership.

The group owner can appoint administrators. Administrative capabilities include:

- Recall/delete messages
- Invite members
- Remove members
- Enable or disable group muting
- Appoint administrators

Additional rules:

1. A group must support more than 1,000 members.
2. Owners and administrators may edit the group name, avatar, announcement, description, and pinned message, and may disable members from adding each other as friends. Ordinary members have no group-management permissions.
3. Users can join through an owner/admin invitation, a group QR code, or a group ID search. Every method requires approval by the owner or an administrator.
4. When a message is recalled, only owners and administrators see the recall notice. Ordinary members see neither the original message nor a recall notice.
5. Group-wide mute must mute everyone except owners and administrators.
6. Specific members can be muted for 10 minutes, one hour, or permanently.
7. The group owner can appoint an unlimited number of administrators.
8. When a member leaves voluntarily or is removed, only owners and administrators see the event; ordinary members see no leave/removal notice.
9. New members cannot view messages sent before they joined.
10. A user's friend-request policy has three modes:
    - Anyone can add me without approval.
    - Approval required: the requester sends an application that I must accept.
    - Nobody can add me: disable every friend-add channel.
11. Friends can see each other's online status.
12. Each account can have up to 1,000 friends.
13. A user can assign notes/aliases and tags to friends.

### 2.4 Messaging and Calls

The chat screen supports text, standard emoji, stickers, GIFs, voice messages, video calls, and voice calls.

- Maximum text message length: 1,000 Chinese characters/characters.
- Maximum voice-message recording length: 60 seconds.
- A voice message can be recorded before it is sent.
- Users can send uploaded video files.
- The composer includes built-in emoji, sticker packs, and GIF search/send.
- Real-time video calling is also requested, but the client indicates that sending video files may be chosen instead depending on scope.
- Supported image/file formats and the maximum size per file must be defined.
- One-to-one messages show a successful-send indicator and read/unread status.
- All messages can be copied and forwarded.
- A user can select friends or groups as forwarding targets in one action.
- Private and group chats support quoted replies.
- Private and group chats support mentioning a person (`@user`) or everyone (`@everyone`).
- All chat history must be retained for at least three months.

## 3. Platforms, Notifications, and Recovery

- Supported platforms: iOS, Android, Web, Windows, and macOS.
- Mobile applications must receive timely notifications while running in the background.
- Integrate the required vendor push-notification services.
- Provide a customized backup and recovery mechanism so data can be restored after a server failure.

## 4. Administration System

The back-office system must support:

1. Account allowlisting and assisted account registration for users in special regions who cannot use a mobile number or download the application.
2. Immediately blocking any user ID from signing in.
3. Viewing the complete chat history of any user ID within any enterprise.
4. Managing all user accounts. If a user forgets a password, an administrator can reset it. The original request also asks administrators to query/view passwords; this must not be implemented because passwords must never be stored in recoverable plaintext.
5. Compatible login across all supported platforms.
6. Strong privacy and security, including firewalling and protection against theft, intrusion, and tracking.
7. A top-level administration console with subaccounts. The top-level operator can issue an enterprise administrator account to each company, with appropriate administrative capabilities.
8. Viewing the registration IP address and inferred region for every user ID.

## 5. Recommended Additional Administration Features

- Role-based access control with separate platform-owner, enterprise-admin, compliance, support, and read-only roles
- Immutable audit logs for every sensitive administrator action
- Mandatory reason entry and approval workflow for reading message content, account access, exports, and bans
- Enterprise, user, group, and device management dashboards
- Active-session and trusted-device management with remote sign-out
- Invitation-code rotation, revocation, usage limits, and usage history
- Abuse reporting, moderation queues, rate limits, and spam detection
- Content and file policy controls, malware scanning, and file-type/size limits
- Data-retention policies, legal hold, compliant export, and deletion workflows
- Backup status, restore testing, disaster-recovery status, and operational health monitoring
- Security policies such as MFA for administrators, IP allowlists, session limits, and login alerts
- Push-delivery, message-delivery, call-quality, storage, and active-user analytics
- Enterprise branding and configurable feature policies

## 6. Open Questions Requiring Client Approval

1. Does “more than 1,000 online” mean total concurrent users, concurrent users per enterprise, or members concurrently active in one group?
2. ~~Does a new login remove the oldest session on the same device category, or all other sessions? How many phone and desktop sessions are allowed?~~ **Decided:** one web + one desktop + one phone; same-type login replaces the previous session.
3. Is phone ownership verified by SMS OTP during registration, or is entering an 11-digit number sufficient?
4. Should an invitation code be permanently reusable, or should administrators be able to rotate/revoke it after leakage?
5. Which countries and phone-number formats must be supported? The 11-digit rule appears specific to mainland China.
6. Does “name” mean a unique username, display name, or both? Which Unicode characters and emoji are allowed?
7. Is a 100 MB avatar truly required? This is unusually large and should normally be reduced and resized server-side.
8. What are the exact allowed image, video, audio, and document formats and size limits?
9. Are real-time voice and video calls part of the first release, or should the first release only support recorded audio and uploaded video?
10. Does sub-one-second latency apply at the 50th, 95th, or 99th percentile, and in which geographic region/network conditions?
11. Does “encrypted message transport” mean TLS in transit only, server-side encryption at rest, or end-to-end encryption? End-to-end encryption conflicts with unrestricted administrator access to message content.
12. What is the exact retention period beyond the stated minimum of three months, and may enterprises configure it?
13. Which administrators may inspect message content, under what legal basis, and with what approval/audit process?
14. Which mobile push services are required: APNs, FCM, Huawei, Xiaomi, OPPO, vivo, or others?
15. What recovery point objective (RPO) and recovery time objective (RTO) are required?
16. What should happen to retained messages and files when a user or enterprise is deleted?
17. Are Windows and macOS native applications required, or can an installable web/Electron client satisfy the requirement?
18. Which existing social application should the prototype use as its visual/interaction reference?

## 7. Security Corrections

- Store passwords only as salted, slow hashes (for example, Argon2id); no administrator can view an existing password.
- Administrators may trigger a secure password reset, ideally forcing the user to choose a new password on the next login.
- Do not label a feature “anti-hacker” or “anti-tracking” without measurable controls. Define authentication, authorization, encryption, audit, vulnerability management, monitoring, incident response, and recovery requirements.
- Administrator access to private messages is a high-risk compliance feature. It requires strict roles, audit logs, reason capture, least privilege, and applicable employee/privacy notices.
- Permanent reusable invitation codes create an uncontrolled access risk. Support revocation and rotation even if codes do not expire by default.
