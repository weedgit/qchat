-- notification device management.
ALTER TABLE push_devices
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_push_devices_user_seen
  ON push_devices(user_id, last_seen_at DESC);
