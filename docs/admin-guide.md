# Qchat Admin guide

Operator guide for the **Rchat Admin** console (`apps/admin`).  
End-user product help: [`user-guide.md`](./user-guide.md).  
Console permission details: [`qchat-permission-matrix.md`](./qchat-permission-matrix.md) and [`security-implementation.md`](./security-implementation.md) § Admin console RBAC.

## Language

Default language is **简体中文**. Use the **Language** selector in the sidebar (or on the login page) to switch to English.

API and validation errors are shown in the selected language via `@qchat/i18n` (`formatAdminError`). Preference is stored in `localStorage` under `qchat.admin.locale`.

---

## Access

- Production (typical): `https://<host>/admin/`
- Local dev: `make admin-dev` → `http://localhost:3001/admin`
- Sign in with a **console role** account (not a normal member). JWT `role` comes from `users.role`; role changes apply after re-login/refresh.

### Demo seed (local / staging)

After `go run ./cmd/seed` in `services/api`:

| Phone | Password | Role |
|---|---|---|
| `13800000001` | `admin12345` | `enterprise_admin` (ACME) |

Platform admin is provisioned by seed / ops (`platform_admin`). Do not use seed passwords in production.

---

## Roles

| Role | Scope | Typical use |
|---|---|---|
| **platform_admin** | Whole platform | Create enterprises, issue enterprise admins, cross-tenant inspect, backups |
| **enterprise_admin** | One enterprise | Day-to-day company back-office |
| **member** | One enterprise | Chat user (no admin console) |

### Capability matrix (console)

| Capability | platform_admin | enterprise_admin |
|---|:---:|:---:|
| Read lists / audits / backup status | ✓ | ✓ |
| Inspect messages (reason required) | ✓ | ✓ |
| Create member (assisted registration) | ✓ | ✓ |
| Issue `enterprise_admin` | ✓ | |
| Reset password / revoke sessions | ✓ | ✓ |
| Ban / unban | ✓ | ✓ |
| Invite rotate / revoke / activate | ✓ | ✓ |
| Enterprise write / retention | ✓ | ✓ |
| Security write (IP allowlist) | ✓ | ✓ |
| Backup / restore | ✓ | |

Most writes are scoped to the operator’s `enterprise_id`. Only **platform_admin** can create companies and assign admins into another enterprise.

---

## Console areas

| Area | Path | What you do |
|---|---|---|
| **Overview** | `/` | High-level counts |
| **Users** | `/users` | Search, assisted provision, ban, reset password, sessions |
| **Groups** | `/groups` | List tenant social groups |
| **Enterprises** | `/enterprises` | Invites, retention, create company + admin (owner), issue admin |
| **Audit log** | `/audits` | Immutable admin action history |
| **Message inspect** | `/messages` | History lookup with mandatory reason |
| **Security** | `/security` | MFA, IP allowlist, login alerts |
| **Backup** | `/backup` | DR status, latest backup age, drill excerpt |

---

## Common workflows

### 1. Create an enterprise and its first admin (platform admin)

**Enterprises** → **Create enterprise + admin**

- Company name, optional invite code  
- Admin phone (11 digits), username, temporary password  

API: `POST /v1/admin/enterprises`  
Returns invite code + `admin_user_id` / `admin_username`.

### 2. Issue another enterprise admin (platform admin)

**Enterprises** → issue admin for a row, or `POST /v1/admin/users` with:

```json
{
  "phone": "13800001111",
  "password": "TempPass1!",
  "username": "acme_ops",
  "role": "enterprise_admin",
  "enterprise_id": "<uuid>"
}
```

Enterprise admins **cannot** create another `enterprise_admin` (403).

### 3. Assisted member registration

**Users** → provision form (phone, username, temp password, role `member`).

Creates the account without self-service captcha/invite flow. Phone must still be 11 digits.

### 4. Ban / unblock a user

**Users** → select user → ban/unban with a **reason** (≥ 8 characters).  
Banned users cannot sign in; sessions are revoked.

### 6. Reset password

**Users** → reset with new password + reason.  
Existing password is **never** viewable or returned. MFA is cleared; sessions revoked.

### 7. Inspect message history

**Message inspect** → user/conversation identifiers + **reason** (audited).  
Platform admins may pass `enterprise_id` for cross-tenant inspect. Enterprise admins stay in-tenant.

### 8. Invite codes

**Enterprises** → rotate / revoke / activate.  
Revoked codes block new registrations; rotation issues a new code.

### 9. Retention

Set `retention_days` per enterprise; **Run retention now** triggers purge for eligible history (default target 90 days).

### 10. Admin security

**Security** page:

- **MFA (TOTP)** — enroll, activate, recovery codes  
- **IP allowlist** — empty = disabled; when set, admin logins must match  
- **Login alerts** — new device / IP (and allowlist denials) in audits  

### 11. Backup & recovery (platform owner only)

**Backup** page — browser control for DR (not available to enterprise admins or sub-roles).

| Action | How |
|---|---|
| **Automatic backup** | Enable schedule + set interval (1–168 hours); API scheduler runs `deploy/backup.sh` when due |
| **Manual backup** | **Run backup now** |
| **Settings** | Include secrets (env + TLS), interval, auto on/off — saved to `backups/settings.json` |
| **Drill restore** | Restore into isolated `qchat_drill` (production untouched) |
| **Production restore** | Overwrites live DB/MinIO — requires audited reason + typing `RESTORE` |

API (platform owner only):

| Method | Path |
|---|---|
| GET | `/v1/admin/backup/status` |
| GET/PATCH | `/v1/admin/backup/settings` |
| POST | `/v1/admin/backup/run` |
| POST | `/v1/admin/backup/restore` |

Host scripts still work for break-glass: [`RESTORE_DRILL.md`](./RESTORE_DRILL.md).

---

## API surface (summary)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/enterprises` | Owner: all; else own enterprise |
| POST | `/v1/admin/enterprises` | Owner only — create + first admin |
| GET | `/v1/admin/users` | Tenant-scoped list (+ register IP/region) |
| POST | `/v1/admin/users` | Assisted create / issue roles |
| POST | `/v1/admin/users/{id}/ban` | Reason required |
| POST | `/v1/admin/users/{id}/reset-password` | Reason required |
| GET/POST | `/v1/admin/users/{id}/sessions…` | List / revoke |
| GET | `/v1/admin/messages` | Reason required |
| GET | `/v1/admin/audits` | Audit trail |
| POST | `/v1/admin/invite/rotate\|revoke\|activate` | Invite lifecycle |
| PATCH | `/v1/admin/enterprises/{id}` | e.g. retention_days |
| POST | `/v1/admin/retention/run` | Run retention |
| GET/POST/DELETE | `/v1/admin/security/ip-allowlist` | IP policy |
| GET | `/v1/admin/security/login-alerts` | Recent alerts |
| GET | `/v1/admin/backup/status` | DR status + settings + job (platform owner) |
| GET/PATCH | `/v1/admin/backup/settings` | Auto schedule settings |
| POST | `/v1/admin/backup/run` | Manual backup |
| POST | `/v1/admin/backup/restore` | Drill or production restore |

All admin routes require a valid access token with a console role. Sensitive actions write `audit_logs`.

---

## Security rules (non-negotiable)

1. **Never** store or display recoverable plaintext passwords — only reset.  
2. Message inspect, ban, and password reset require a usable **reason** (audited).  
3. Tenant isolation: enterprise admins only see their company unless the handler explicitly allows platform owner.  
4. Prefer MFA + IP allowlist for all console operators in production.

---

## Troubleshooting

| Problem | What to try |
|---|---|
| Redirected to login | Token expired / not a console role |
| 403 on action | Role lacks permission (see matrix above) |
| Cannot create enterprise | Must be `platform_admin` |
| Cannot issue enterprise admin | Only `platform_admin`; check `enterprise_id` |
| Backup page empty / 403 | Platform admin only; sign in as `platform_admin` |
| Message inspect denied | Role must allow inspect; supply reason ≥ 8 chars |
| Banned user still online | Ban revokes sessions; force refresh if a stale tab remains |

---

## Related docs

- [`requirements-en.md`](./requirements-en.md) §4 — administration requirements  
- [`backup-recovery-review.md`](./backup-recovery-review.md) — backup requirement review  
- [`RESTORE_DRILL.md`](./RESTORE_DRILL.md) — backup/restore runbook  
- [`security-implementation.md`](./security-implementation.md) — MFA, allowlist, audits  
- [`HARDENING.md`](./HARDENING.md) — launch checklist  
