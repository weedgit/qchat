-- Company-wide default social group (internal chat) per enterprise.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_enterprise_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_enterprise_default
  ON conversations (enterprise_id)
  WHERE is_enterprise_default = TRUE;
