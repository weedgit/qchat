-- Device-scoped sessions and 1:1 call endpoints (caller/answerer device).
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS device_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sessions_user_device
  ON sessions(user_id, device_id)
  WHERE revoked = FALSE;

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS initiator_device_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS answerer_device_id TEXT NOT NULL DEFAULT '';
