# Requirements — Short Test Checklist

> Condensed from `requirements-en.md` for cross-platform testing.  
> Platforms: **desk** (Windows/macOS), **web**, **mobile** (iOS/Android).  
> Admin items are **admin** (back-office web).

## Client

1. Register with phone + invite code (desk/web/mobile)
2. Login with password + CAPTCHA (desk/web/mobile)
3. Remember login / stay signed in (desk/web/mobile)
4. Multi-device session (phone + desk same time; same-type kick) (desk/web/mobile) — **Supported:** one web + one desktop + one phone; same-type login kicks the prior client via `session.revoked`
5. Edit profile (avatar, name, real name, age, region, status) (desk/web/mobile)
6. Profile visibility (public / friends-only) (desk/web/mobile)
7. Add / manage friends + notes/tags (desk/web/mobile)
8. Friend-request policy (anyone / approval / nobody) (desk/web/mobile)
9. Online status for friends (desk/web/mobile)
10. One-to-one private chat (desk/web/mobile)
11. Group chat (desk/web/mobile)
12. Conversation / message list (desk/web/mobile)
13. Text + built-in emoji, stickers, GIFs (desk/web/mobile)
14. Voice messages (≤60s) (desk/web/mobile)
15. File / image transfer (desk/web/mobile)
16. Upload / send video files (desk/web/mobile)
17. Sent / read / unread states (desk/web/mobile)
18. Copy + forward messages (desk/web/mobile)
19. Quoted reply (desk/web/mobile)
20. @mention user / @everyone (desk/web/mobile)
21. Voice call (desk/web/mobile)
22. Video call (desk/web/mobile)
23. Create group + invite members (desk/web/mobile)
24. Join group by ID / QR (needs approval) (desk/web/mobile)
25. Group admin: mute, remove, recall, announce, pin (desk/web/mobile)
26. Group mute (all / timed / permanent member) (desk/web/mobile)
27. New member cannot see history before join (desk/web/mobile)
28. Push notifications (background) (mobile)
29. Message latency &lt; 1s (desk/web/mobile)

## Admin

30. Enterprise invite codes (create / rotate / revoke) (admin)
31. Ban / block user login (admin)
32. Reset user password (admin)
33. View chat history (with reason / audit) (admin)
34. Manage users / enterprises / devices (admin)
35. View registration IP / region (admin)
36. Audit logs for sensitive admin actions (admin)

## Non-functional smoke

37. Encrypted transport (TLS) (desk/web/mobile)
38. Concurrent online users (&gt;1000) (server)
39. Chat history retained ≥ 3 months (server)
40. Backup / recovery after server failure (server)
