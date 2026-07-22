-- channel prefs: favorite (pin-to-top) and mute (notify_props).
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;
