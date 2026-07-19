-- Rotating refresh support + SMS-ready phone change challenges
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES sessions(id);

CREATE TABLE IF NOT EXISTS phone_change_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    new_phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_change_user ON phone_change_challenges(user_id);

CREATE TABLE IF NOT EXISTS sms_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    body TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'dev',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
