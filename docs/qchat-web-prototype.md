# Qchat Web Prototype Specification

## Layout (desktop ≥ 960px)

```
┌────────┬──────────────────┬────────────────────────────┬─────────────┐
│ Nav    │ Conversation     │ Active chat                │ Details     │
│ icons  │ list + search    │ header / timeline / composer│ drawer      │
└────────┴──────────────────┴────────────────────────────┴─────────────┘
```

Mobile collapses to list → chat → details stack.

## Screens

1. **Register / Login** — phone, invite code, password, CAPTCHA, remember-me.
2. **Chat list** — unread badges, presence dots, pinned chats, search.
3. **DM** — bubbles, ticks (sent/delivered/read), quote reply, media.
4. **Social group** — member count, mute banner, @mentions, admin actions.
5. **Channel / thread** — collaboration replies in side panel; default view stays simple.
6. **Friends** — requests, privacy modes, notes/tags.
7. **Profile** — avatar, name, signature, visibility.
8. **Admin** — enterprises, users, bans, invites, audits, message access.

## Visual tokens

- Background: `#0E1621` (dark) / `#FFFFFF` (light)
- Accent: `#2AABEE`
- Message out: `#2B5278`
- Message in: `#182533`
- Radius: 12px bubbles, compact list rows 64px
- Typography: system UI / Inter, 14–15px body

## Prototype location

Implemented as interactive routes in `qchat/apps/web` (login, chats, friends, profile) and `qchat/apps/admin`.
