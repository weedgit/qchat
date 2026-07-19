# Qchat Permission Matrix

Legend: Y = allowed, N = denied, A = audited + reason required, O = own resources only.

| Capability | Platform owner | Enterprise admin | Group owner | Group admin | Channel admin | Member | Friend |
|---|---|---|---|---|---|---|---|
| Issue enterprise admin | Y | N | N | N | N | N | N |
| Ban / unban any user | Y | Y (tenant) | N | N | N | N | N |
| Reset password | Y | Y (tenant) | N | N | N | N | N |
| View registration IP/region | Y | Y (tenant) | N | N | N | N | N |
| Inspect message history | A | A (tenant) | N | N | N | N | N |
| Manage invite codes | Y | Y (tenant) | N | N | N | N | N |
| Create social group | N | Y | Y | Y | N | Y | Y |
| Appoint group admin | N | Y | Y | N | N | N | N |
| Kick group member | N | Y | Y | Y | N | N | N |
| Mute all / member timed | N | Y | Y | Y | N | N | N |
| Recall any group message | N | Y | Y | Y | N | O (own, short window) | O |
| See recall / leave notices | Y | Y | Y | Y | N | N | N |
| Edit group profile / pin | N | Y | Y | Y | N | N | N |
| Approve join requests | N | Y | Y | Y | N | N | N |
| Post in announcement channel | N | Y | N | N | Y | N | N |
| Manage channel members | N | Y | N | N | Y | N | N |
| Create thread / react | N | Y | Y | Y | Y | Y | Y |
| Send DM | N | Y | Y | Y | Y | Y | Y |
| Add friend | N | Y | Y | Y | Y | Y | Y |
| View friend presence | N | Y | Y | Y | Y | Y | Y |

## Notes

- Passwords are never viewable; only reset is allowed.
- Social-group leave/kick notices are invisible to ordinary members.
- New social-group members cannot read messages before `history_visible_from`.
- Collaboration channels may allow pre-join history unless enterprise policy disables it.
