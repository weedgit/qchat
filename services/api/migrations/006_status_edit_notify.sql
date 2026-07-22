-- user status (online|away|dnd|offline) and notify_props.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS status_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_props JSONB NOT NULL DEFAULT '{"desktop":"all","sound":true,"mentions_only":false}'::jsonb;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
