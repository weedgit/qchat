-- Session last activity for Settings → active sessions.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

UPDATE sessions
SET last_active_at = COALESCE(last_active_at, created_at)
WHERE last_active_at IS NULL;
