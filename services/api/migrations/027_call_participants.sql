-- Group call invitees / participants (host can kick; mid-call invite).
CREATE TABLE IF NOT EXISTS call_participants (
    call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'invited',
    -- invited | joined | declined | kicked | left
    invited_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, user_id)
);

CREATE INDEX IF NOT EXISTS call_participants_user_idx
    ON call_participants (user_id, status);
