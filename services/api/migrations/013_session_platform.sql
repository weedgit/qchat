-- Richer active-session display: IP, location, platform label.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS ip TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ip_region TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
