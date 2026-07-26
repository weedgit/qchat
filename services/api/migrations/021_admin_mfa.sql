-- Admin MFA (TOTP). Secret is empty until enrollment; mfa_active gates login.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mfa_active BOOLEAN NOT NULL DEFAULT FALSE;
