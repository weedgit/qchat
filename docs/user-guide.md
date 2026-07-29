# Qchat User Guide

Qchat is a secure enterprise messenger for small teams. Use it on **web**, **desktop**, or **mobile** with the same account. Admins manage users and compliance in **Qchat Admin**.

**Languages:** English and 简体中文  
**Clients:** Web · Qchat Desktop · Mobile (Expo) · Admin console

---

## 1. Getting started

### What you need

- A **company invite code** from your organization admin (for example `ACME2026`)
- A valid **phone number** (11 digits) for login and SMS verification
- One of: a modern browser, Qchat Desktop, or the mobile app

### Create an account (Register)

1. Open Qchat and choose **Register**.
2. Enter your **phone**, **username**, and **password** (at least 8 characters; digits, or letters and digits).
3. Enter your **company invite code**.
4. Complete the **captcha**.
5. Tap **Send code**, enter the **SMS code**, then **Create account**.

### Sign in

1. Enter **phone**, **password**, and **captcha**.
2. Optionally enable **Remember me** (keeps you signed in longer on trusted devices).
3. Tap **Sign in**.

If your account was banned, you will see a ban notice and cannot use the app until an admin lifts it.

### Multi-device sessions

You can stay signed in on **one web**, **one desktop**, and **one phone** session at the same time.

- Signing in on a second browser (same type) **replaces** the previous web session.
- The same rule applies for desktop and phone.
- Revoke other devices anytime under **Settings → Login sessions**.

---

### Download apps (web)

On the sign-in / register screen, tap **Download** (top-right). Open `/download` to get Windows, macOS, Linux, Android, and iOS builds when your organization publishes them. The download page is web-only (hidden inside the desktop shell).

---

## 2. Main navigation

| Web / Desktop | Mobile | Purpose |
|---|---|---|
| **Chats** | **Chats** (消息) | Conversation list and messages |
| **Contacts** / Friends | **Contacts** (通讯录) | Friends and friend requests |
| **Groups** | via chat / create-group | Create, join, and manage groups |
| **My profile** | **Me** (我的) | Avatar, profile, privacy, QR |
| **Settings** | **Settings** (设置) | Theme, language, notifications, sessions |
| **Log Out** | **Sign out** | End this device session |

**Menu shortcuts (web/desktop):** Contacts, Groups, Join a company, Settings, Theme, Language, **New Group**, **New Private Chat**, **Scan QR**, **Show QR**.

---

## 3. Chats and messaging

### Conversation list

- See direct messages (DMs) and group chats.
- Unread counts and **@ mention** badges appear on conversations.
- Favorite chats with ★; muted chats stay quiet.
- Online status shows on DMs (when available).
- Use the search box to find **people** and **messages**.

### Starting a chat

- **New Private Chat** — open a DM with a contact.
- **New Group** — create a group and invite friends.
- From **Contacts**, tap **Message** on a friend.

### Sending messages

| Type | Notes |
|---|---|
| Text | Up to **1000** characters; emoji supported |
| Stickers / GIFs | From the composer picker (GIFs need server Giphy config) |
| Photos / files | Drag-drop or attach; images and files up to **100 MB** |
| Video | Up to **200 MB** |
| Voice | Hold/record; max **60 seconds** |
| Mentions | Type `@name` in a group to notify someone |

### Message actions

On a message you can:

- **Reply** — quote and respond
- **Copy** — copy text
- **Edit** — change your own message (when allowed)
- **Pin / Unpin** — pin important messages (banner + cycle in thread)
- **React** — add an emoji reaction
- **Forward** — send to one or more chats
- **Recall** — withdraw a sent message
- **Multi-select** — copy, forward, or recall several at once

### Delivery and read status

- DMs show **sent → delivered → read**.
- Groups can show read counts (for example `3/10`) and who has read the message.

### Conversation options

Right-click or open the chat menu for:

- Pin / unpin chat  
- Mute  
- Mark unread  
- Block (DM)  
- Clear history (clears your local view)  
- Delete chat or leave group  
- Open in new window (desktop/web where supported)

### Drafts and typing

- Unsent text is kept as a draft per conversation.
- Others see a typing indicator while you compose.

---

## 4. Contacts and privacy

### Add friends

1. Open **Contacts**.
2. Search by **username**, **phone**, or **user ID**.
3. Send a friend request.
4. Accept or reject **Incoming requests**.

You can set a **note** (alias) on a friend, **block** / unblock, and open a DM.

Some enterprises disable member-to-member friend adds; follow your company policy if add is blocked.

### Profile privacy

Under **My profile** / **Me → Edit Profile**:

| Setting | Options |
|---|---|
| **Profile visibility** | Public · Friends only |
| **Friend requests** | Anyone can add me · Need my approval · Nobody can add me |
| **Status** | Online · Away · Do not disturb · Offline |

### Profile fields

- Avatar (JPEG, PNG, GIF, or WebP; max 100 MB)
- Username (unique; 2–32 letters, numbers, underscores, or emoji)
- Display name, real name, age, region, Role (signature)
- **Show QR** / share QR so others can find you
- Copy phone, username, or ID

### Join another company

Use **Join a company** (menu or Me) and enter a new invite code when your admin provides one.

---

## 5. Groups

### Create a group

1. Choose **New Group**.
2. Set a title (and optional avatar).
3. Invite friends.
4. Create the group.

### Join a group

- Enter a **group ID**, or  
- **Scan QR** / open a `qchat://join/…` link, or  
- Paste an invite when prompted.

Owners/admins may need to **approve** your join request.

### Roles

| Role | Typical powers |
|---|---|
| **Owner** | Full control, including dissolve / transfer |
| **Admin** | Moderate members, mutes, announcements |
| **Member** | Chat, react, leave |

### Group management

Owners and admins can:

- Edit name, description, avatar, and **announcement**
- Pin the group, mute all, or timed mute (**10 minutes / 1 hour / permanent**)
- Appoint admins, remove members, invite or add members
- Approve pending joins
- Share an invite QR
- Optionally forbid members from adding each other as friends

### History boundary

New members **do not** see messages from before they joined.

### Leave or delete

- **Leave** removes you from the group.
- **Delete** removes the conversation from your list (per client rules).

---

## 6. Voice and video calls

Qchat uses LiveKit for realtime media.

### 1:1 calls

- Start a **voice** or **video** call from a DM.
- Accept, decline, or miss — the chat records a call event (including duration when ended).

### Group calls

- Invite participants into a group call.
- Hosts can invite or remove participants where supported.

### In-call controls

- Mute microphone  
- Camera on/off  
- **Share screen** (web and desktop)  
- Grid / focus layout  
- Minimize back to chat  
- Hang up  

**Tip:** Calls need a reachable LiveKit server. On LAN, clients must use a host IP other devices can reach (not only `localhost` on another machine).

---

## 7. Settings

### Appearance

- **Theme:** Dark · Light · System  
- **Language:** English · 简体中文 · System  

### Notifications

| Preference | Meaning |
|---|---|
| **All new messages** | Notify for every message |
| **Mentions only** | Only @mentions (can override broader desktop prefs) |
| **Nothing** | No message notifications |
| **Play notification sound** | On / off |

Push works via browser Web Push, desktop native notifications, and mobile Expo push when configured.

### Login sessions

- See web, desktop, and mobile sessions (location estimated from IP).
- **Revoke** any session you do not recognize.

### Notification devices (web)

Remove old browser push subscriptions under **Notification devices** so stale tabs stop receiving alerts.

### Change phone number

1. Open **Settings → Change phone number**.
2. Enter the new 11-digit phone.
3. **Send SMS code**, verify, and confirm.

### Install as app (PWA)

On supported browsers, use **Install Qchat** (or Share → Add to Home Screen on iOS) for a full-screen experience.

---

## 8. Qchat Desktop

Desktop is an Electron shell around the same web app, with native extras:

- System tray; close can minimize to tray  
- Unread badge on taskbar/dock; mention attention flash  
- Click a notification to open that conversation  
- Idle → **Away** (does not override Do not disturb)  
- Deep links: `qchat://conversation/<id>`  
- Autostart and hide-on-start options  
- Native download save dialog  
- Screen capture for screen share  
- Optional auto-update when an update URL is configured  

### Connect to your server

| Situation | Typical approach |
|---|---|
| Local development | `npm run dev` (starts web if needed) |
| LAN server | Point desktop at your LAN web URL (`start:lan` / custom `--url`) |
| Production VPS | Point at your HTTPS host |

Config order: `--url` → `QCHAT_WEB_URL` → `.env` → `userData/config.json` → packaged defaults.

---

## 9. Mobile app

Tabs: **Chats** · **Contacts** · **Me** · **Settings**.

Same core features as web: messaging, media, voice notes, reactions, pins, calls, friends, groups, profile, sessions, and join company.

Configure API and LiveKit URLs via `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_LIVEKIT_URL` (see `apps/mobile/README.md` for build and TLS notes).

---

## 10. Qchat Admin (operators)

Open the admin console (dev: `http://localhost:3001`). Access depends on your role.

### Roles (overview)

| Role | Scope |
|---|---|
| **Platform owner** | Full platform control |
| **Enterprise admin** | One enterprise |
| **Compliance** | Audits / inspect with reasons |
| **Support** | Assisted user operations |
| **Read only** | View without mutating |

Exact capabilities: see [`qchat-permission-matrix.md`](./qchat-permission-matrix.md).

### Console areas

| Area | What you can do |
|---|---|
| **Overview** | High-level status |
| **Users** | Search, create, ban, reset password (reason required), view/revoke sessions |
| **Groups** | Manage tenant groups |
| **Enterprises** | Activate / revoke / rotate invite codes; retention days |
| **Audit log** | Immutable record of admin actions |
| **Message inspect** | View message history **only with a mandatory reason** (audited) |
| **Security** | Admin MFA (TOTP + recovery), IP allowlist, login alerts |

---

## 11. Demo seed accounts (local / staging)

After seeding the API (`go run ./cmd/seed`):

| Phone | Password | Invite | Role |
|---|---|---|---|
| `13800000001` | `admin12345` | `ACME2026` | Enterprise admin |
| `13800000002` | `user12345` | `ACME2026` | Member (alice) |
| `13800000003` | `user12345` | `ACME2026` | Member (bob) |

Second enterprise invite: `BETA2026`.

---

## 12. Troubleshooting

| Problem | What to try |
|---|---|
| Cannot register | Confirm invite code is active; complete captcha and SMS |
| Logged out unexpectedly | Another login of the same device type replaced this session |
| No call audio/video | Check LiveKit URL reachability; firewall/TURN; use LAN IP not peer’s `localhost` |
| No GIFs | Server needs `QCHAT_GIPHY_API_KEY` |
| No push on web | Allow notifications; re-register under Settings; remove stale push devices |
| Self-signed HTTPS (desktop) | Trust the certificate when prompted, or use a proper cert |
| Reconnecting banner | API/WebSocket unreachable — check network and API health (`/healthz`) |
| Banned account | Contact your enterprise admin |

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Enterprise** | Your company tenant (joined by invite code) |
| **Invite code** | Reusable join code; admins can revoke or rotate it |
| **DM / Private chat** | One-to-one conversation |
| **Social group / Group** | Multi-member chat with roles and moderation |
| **Recall** | Withdraw a sent message |
| **Presence** | Online / Away / DND / Offline |
| **Session** | Signed-in device (web, desktop, or phone) |

Full EN/中文 glossary: [`qchat-domain-terminology.md`](./qchat-domain-terminology.md).

---

## Related docs

- Security implementation: [`security-implementation.md`](./security-implementation.md)
- Product requirements: [`requirements-en.md`](./requirements-en.md) / [`requirements-zh.md`](./requirements-zh.md)
- Deployment (VPS vs LAN): [`deployment-modes.md`](./deployment-modes.md)
- Desktop developer notes: [`../apps/desktop/README.md`](../apps/desktop/README.md)
- Mobile developer notes: [`../apps/mobile/README.md`](../apps/mobile/README.md)
- Implementation status: [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md)
