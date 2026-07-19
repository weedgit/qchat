# Mattermost vs Qchat Requirements (JD Mapping)

Legend:

- ✅ **Built-in** — available in free Team Edition out of the box
- 🔵 **Enterprise** — requires paid Mattermost Enterprise license
- 🟡 **Partial / config / plugin** — possible but limited, needs configuration, a plugin, or a workaround
- ❌ **Not available** — must be custom-built

> Note on model mismatch: Mattermost is organized as **Teams → Channels**, with a **workspace-wide membership** model. Your JD assumes a **WeChat/QQ-style friend + group** model. Several JD items don't map cleanly because Mattermost has no "friend" concept and channels behave differently from social groups.

---

## 1. Registration & Login

| JD Requirement | Mattermost | Status |
|---|---|---|
| Phone-number registration (11-digit) | Uses email/username + password by default; no native phone signup | ❌ |
| SMS / phone verification | Not built-in | ❌ |
| Enterprise internal invite code (permanent, reusable) | Has invite links & email invites; can be set to not expire, but not a "company code" model | 🟡 |
| Multi-tenant enterprises | Multiple **Teams** on one server, or separate instances; not true isolated tenants | 🟡 |
| Graphical CAPTCHA on login (anti-brute-force) | No native CAPTCHA; has MFA, rate limiting; CAPTCHA needs reverse proxy/custom | 🟡 |
| Phone + PC online at same time | Multiple simultaneous sessions supported | ✅ |
| New device kicks old device | Not default — multiple sessions allowed; would need custom session policy | ❌ |
| "Remember me" up to 60 days | Session length fully configurable | ✅ |
| Password login | Yes | ✅ |
| Password rules (min 8, digits/letters) | Configurable password requirements | ✅ |
| No password recovery service | Email-based reset exists; can be disabled | ✅ |

## 2. User Profile

| JD Requirement | Mattermost | Status |
|---|---|---|
| Edit avatar, nickname, first/last name, position | Supported profile fields | ✅ |
| Age, region, personal signature fields | Not standard; custom profile attributes | 🔵 |
| Profile visibility (public / friends-only) | No friend model; limited visibility controls | ❌ |
| Avatar formats (jpg/png/gif) | Supported | ✅ |
| Avatar up to 100 MB | Configurable, but 100 MB is impractical/not recommended | 🟡 |
| Unique username, no special chars | Username rules enforced | ✅ |
| Emoji in display name | Display name is flexible | 🟡 |

## 3. Groups & Friends

| JD Requirement | Mattermost | Status |
|---|---|---|
| Group chat | Channels (public/private) | ✅ |
| 1,000+ members per group | Channels scale to large membership | ✅ |
| Create group & invite | Yes | ✅ |
| Search group by ID and request to join | Public channels are searchable/joinable; no "request + approve to join" flow | 🟡 |
| Join requires owner/admin approval | No native join-approval workflow (private = invite-only) | ❌ |
| Join via QR code | Not native | ❌ |
| Owner appoints admins / roles | Channel & team admin roles; custom roles | ✅ / 🔵 |
| Admin: recall/delete others' messages | Configurable via permission scheme | ✅ / 🔵 |
| Admin: invite / kick members | Yes | ✅ |
| Group-wide mute (read-only channel) | Read-only / channel moderation | 🔵 |
| Mute **specific member** for 10min/1hr/permanent (timed) | Not available (no per-user timed mute) | ❌ |
| Edit group name / announcement / description / pinned | Channel header, purpose, pinned posts | ✅ |
| Group avatar | Not native for channels | ❌ |
| Disable members adding each other as friends | No friend model | ❌ |
| Recall notice visible only to admins | Not configurable; deleted messages just disappear | ❌ |
| Hide join/leave/kick notices from normal members | Join/leave system messages can be hidden via display setting (all-or-nothing) | 🟡 |
| New members can't see history before joining | **Not supported** — new members see full history | ❌ |
| Friend requests (3 modes) | No friend system; DMs open within team | ❌ |
| Online status | Presence (online/away/DND/offline) | ✅ |
| Max 1,000 friends | No friend model | ❌ |
| Friend notes / aliases / tags | Not built-in | ❌ |

## 4. Messaging & Calls

| JD Requirement | Mattermost | Status |
|---|---|---|
| Text messages | Yes | ✅ |
| Text max 1,000 chars | Max message length configurable | ✅ |
| Built-in emoji | Yes | ✅ |
| Block custom sticker/emoji upload | Custom emoji exist; can be disabled by permission | ✅ |
| Voice messages | Supported | ✅ |
| Voice message max 60s | Voice messages exist; fixed length limit not clearly configurable | 🟡 |
| Record before send | Yes | ✅ |
| Upload & send video files | File upload | ✅ |
| Real-time voice/video calls | **Calls** plugin (1:1 + group, screen share) | ✅ |
| Image/file formats & size limits | Configurable max file size & allowed types | ✅ |
| 1:1 "sent" indicator | Pending/sent state shown | ✅ |
| 1:1 read / unread receipts (per message) | **Not supported** — only manual "Acknowledge" button / message priority | ❌ |
| Copy message | Yes | ✅ |
| Forward message | Yes | ✅ |
| Forward to multiple targets at once | Forward to a channel/DM; multi-select limited | 🟡 |
| Quote / reply | Threaded replies + quote | ✅ |
| @mention person / @all / @channel / @here | Yes | ✅ |
| Retain history 3+ months | Kept indefinitely by default; retention policy = Enterprise | ✅ / 🔵 |

## 5. Platforms, Notifications, Recovery

| JD Requirement | Mattermost | Status |
|---|---|---|
| iOS / Android | Official apps | ✅ |
| Web | Official | ✅ |
| Windows / macOS / Linux desktop | Official Electron apps | ✅ |
| Background push notifications | Supported via push proxy (hosted or self-run) | ✅ |
| Chinese OEM push (Huawei/Xiaomi/OPPO/vivo) | Not built-in | ❌ |
| Custom backup / disaster recovery | Standard DB/file backup; ops responsibility, no turnkey DR | 🟡 |

## 6. Administration / Backend

| JD Requirement | Mattermost | Status |
|---|---|---|
| Allowlist / assisted account creation | Admin can create users manually | ✅ |
| Ban / deactivate any account | Deactivate users | ✅ |
| View any user's full chat history | Compliance export / message export | 🔵 |
| Reset any user's password | Yes | ✅ |
| **View / query existing password** | Impossible by design (hashed) — and must never be built | ❌ (by design) |
| Multi-platform login | Yes | ✅ |
| Security (firewall/anti-intrusion) | Deployment/infra responsibility; MM provides auth, MFA, audit | 🟡 |
| Terminal + enterprise sub-admin accounts | System/team admin roles; delegated granular admin = Enterprise | 🔵 |
| View registration IP & region per user | Some data in logs/sessions; no clean IP+geo UI | 🟡 |
| Audit logs of admin actions | Audit logging | 🔵 |

---

## Summary: where Mattermost fits your JD

**Strong fit (free or config):**
- Core text messaging, channels/groups at scale, mentions, quotes, forwarding
- Voice messages, real-time voice/video calls (Calls plugin)
- All 5 client platforms (iOS, Android, Web, Windows, Mac)
- Password rules, sessions, push notifications, file sharing
- Basic admin: create/deactivate users, reset passwords

**Needs Enterprise license (paid):**
- Compliance/message export (reading any user's history)
- Data retention policies
- Granular custom roles, channel moderation, audit logs
- Custom profile attributes

**Must be custom-built (JD gaps):**
- Phone-number registration + SMS + graphical CAPTCHA
- "New device kicks old device" session policy
- Friend system (requests, 3 privacy modes, notes/tags, 1,000-friend cap)
- Join-by-approval + group QR code
- **Per-message read/unread receipts** (JD-critical)
- **Hide pre-join history from new members** (JD-critical)
- Timed per-member mute (10min/1h/permanent)
- Admin-only recall notices; hide leave/kick from normal members
- Chinese OEM push integration
- Registration IP + geolocation admin view
- True multi-tenant enterprise isolation with invite codes

## Recommendation

Mattermost covers roughly the **"messaging + calls + multi-platform + basic admin"** core, which is a large part of the effort. But several **JD-defining behaviors are Chinese-social-app conventions** (friends, read receipts, join approval, pre-join history hiding, timed mute, OEM push) that Mattermost deliberately does **not** implement and that clash with its team/channel model.

Two viable paths:

1. **Fork Mattermost** — fastest to a working product; but the friend model, read receipts, join-approval, and history-hiding require deep changes to core, and Enterprise features (export/retention/roles) mean licensing. Heavy customization fighting the platform's assumptions.
2. **Build Qchat custom** (per `implementation-plan.md`) — more upfront work, but the social/friend model, read receipts, and tenant model match the JD natively without fighting an opinionated platform.

For a JD this WeChat/QQ-flavored, custom (path 2) is usually the better long-term fit, using Mattermost only as a reference for architecture and the calls/WebRTC layer.
