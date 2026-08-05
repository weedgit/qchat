-- Member-visible company support contact (invite help, IT issues).
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS support_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS support_phone TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN enterprises.support_email IS 'Optional support email shown to enterprise members.';
COMMENT ON COLUMN enterprises.support_phone IS 'Optional support phone shown to enterprise members.';
