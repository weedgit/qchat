-- Allow accounts before joining a company; invite is used via POST /v1/enterprises/join.
ALTER TABLE users ALTER COLUMN enterprise_id DROP NOT NULL;

-- Login is by phone alone (no invite), so phone must be globally unique.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_enterprise_id_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone);

-- Usernames are also global for the same reason.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_enterprise_id_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users (lower(username));

-- Register OTP no longer requires an invite code.
ALTER TABLE register_otp_challenges ALTER COLUMN invite_code DROP NOT NULL;
ALTER TABLE register_otp_challenges ALTER COLUMN invite_code SET DEFAULT '';
