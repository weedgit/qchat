-- Three roles only: platform_admin, enterprise_admin, member.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'platform_admin' WHERE role = 'platform_owner';
UPDATE users SET role = 'member' WHERE role IN ('compliance', 'support', 'read_only');

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('member', 'platform_admin', 'enterprise_admin'));

COMMENT ON COLUMN users.role IS 'member | platform_admin | enterprise_admin';
