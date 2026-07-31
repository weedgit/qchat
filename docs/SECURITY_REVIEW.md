# Qchat Security Review Checklist

Manual review before public / internet-facing use. compliance concerns: auth abuse, tenant isolation, admin access, uploads.

Run through this list on a staging host after `QCHAT_ENV=production` and a rotated JWT secret.

## Auth & registration

| Check | Expected | Status |
|---|---|---|
| CAPTCHA required on login/register | 400 without valid captcha | |
| Phone change requires current password | 401 without correct password | |
| Invite revoked blocks register | 400 invalid invite | |
| Weak password rejected | 400 from `ValidatePassword` | |
| Same-type device session kick | new desktop/phone/web replaces prior same type; old client gets `session.revoked` + 401 | Done |
| Production refuses default JWT | API exits if `QCHAT_ENV=production` + weak secret | |

## Tenant isolation (IDOR)

| Check | Expected | Status |
|---|---|---|
| User A (ACME) cannot open BETA conversation by ID | 403 / empty | |
| Media URL from other enterprise | 403 (`enterprise_id/` prefix) | |
| Friend request across enterprises | blocked / not found | |
| Admin of ACME cannot ban BETA users | update affects 0 / scoped by `enterprise_id` | |
| Message inspect scoped to admin enterprise | only ACME rows | |

## Admin / compliance

| Check | Expected | Status |
|---|---|---|
| Message inspect requires reason ≥8 chars | 400 without | |
| Message inspect writes `audit_logs` | row with reason + actor | |
| Password reset never returns old password | only `ok` + note | |
| Ban revokes sessions | banned user cannot refresh | |

## Uploads

| Check | Expected | Status |
|---|---|---|
| Disallowed Content-Type rejected | 400 | |
| Path traversal `../` on media get | 400 | |
| Oversized file rejected | 400 | |

## Edge / ops

| Check | Expected | Status |
|---|---|---|
| Nginx auth rate limit returns 429 under burst | `limit_req` zone `qchat_auth` | |
| `/metrics` not exposed on public nginx | 404 from `nginx-qchat.conf` | |
| TLS enabled in production | HTTPS only | |
| Backup + restore drill documented | see `docs/RESTORE_DRILL.md` | |

## Known accepted risks (MVP)

- Captcha returns plaintext challenge in JSON (replace with image CAPTCHA for production).
- CORS allows any `http://localhost:*` Origin for local web/admin.

## Fixes applied from this review pass

- Reject unknown upload MIME types (no generic octet-stream fallback).
- Require ≥8 character reason for admin message inspect.
- Document invite revoke / JWT / nginx rate limits as launch controls.
