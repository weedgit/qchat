-- Enforce unique display names (case-insensitive), matching the username policy
-- introduced in 015_enterprise_join.sql. Requirements §2.2: names must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_uidx ON users (lower(display_name));
