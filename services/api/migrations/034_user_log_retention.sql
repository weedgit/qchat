-- User log retention (default 3 months).
ALTER TABLE enterprises
    ADD COLUMN IF NOT EXISTS user_log_retention_days INT NOT NULL DEFAULT 90;

CREATE TABLE IF NOT EXISTS platform_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    user_log_retention_days INT NOT NULL DEFAULT 90
);

INSERT INTO platform_settings DEFAULT VALUES ON CONFLICT DO NOTHING;
