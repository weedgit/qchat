# Qchat Domain Terminology (EN / 中文)

| English | Chinese | Definition |
|---|---|---|
| Enterprise | 企业 | Tenant organization joined via invitation code |
| Invitation code | 邀请码 | Permanent reusable enterprise join code (revocable by admin) |
| User / Account | 用户 / 账号 | Person registered with phone number |
| Profile | 个人资料 | Avatar, unique name, real name, age, region, signature, visibility |
| Friend | 好友 | Bidirectional contact relationship (max 1,000) |
| Friend request | 好友申请 | Pending add-friend application |
| Direct message (DM) | 私聊 | One-to-one conversation between friends/contacts |
| Social group | 群聊 | JD-style group with join approval, roles, mute, history boundary |
| Space / Team | 空间 / 团队 | Collaboration workspace inside an enterprise |
| Channel | 频道 | Collaboration conversation (public / private / announcement) |
| Thread | 话题回复 | Nested reply chain under a root message |
| Conversation | 会话 | Umbrella term for DM, social group, or channel |
| Membership | 成员关系 | User ↔ conversation link with role, joined_at, mute_until, history_visible_from |
| Message | 消息 | Text, emoji, media, voice, system, or call event |
| Receipt | 回执 | Sent / delivered / read states (DMs always; groups by policy) |
| Recall | 撤回 | Soft-delete message; admin-only notice in social groups |
| Presence | 在线状态 | Online / away / offline visibility among friends |
| Session / Device | 会话 / 设备 | Authenticated client; phone + desktop may coexist; same-type replacement |
| Platform owner | 平台终端 | Super-admin that issues enterprise admin accounts |
| Enterprise admin | 企业管理员 | Admin scoped to one enterprise |
| Group owner / admin | 群主 / 群管理 | Social-group moderation roles |
| Channel admin | 频道管理员 | Collaboration-channel moderation role |

## Conversation types

1. **DM** — 1:1, read receipts, friend-gated by default.
2. **Social group** — JD rules: join approval, timed mute, admin-only recall/leave notices, no pre-join history.
3. **Public channel** — joinable within enterprise/space; collaboration features enabled.
4. **Private channel** — invite-only collaboration channel.
5. **Announcement channel** — read-only for members; admins post.
