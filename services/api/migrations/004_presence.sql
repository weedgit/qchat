-- presence: last_activity_at equivalent for last-seen text.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at DESC);
