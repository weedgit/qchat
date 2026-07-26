-- Document and constrain admin-console roles (requirements-en §5 RBAC).
COMMENT ON COLUMN users.role IS
  'member | platform_owner | enterprise_admin | compliance | support | read_only';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN (
        'member',
        'platform_owner',
        'enterprise_admin',
        'compliance',
        'support',
        'read_only'
      ));
  END IF;
END $$;
