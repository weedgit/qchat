-- Multiple pinned messages per conversation.
-- conversations.pinned_message_id remains the newest pin for backward compatibility.

CREATE TABLE IF NOT EXISTS conversation_pins (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_pins_conv_at
    ON conversation_pins (conversation_id, pinned_at DESC);

-- Backfill existing single-pin column into the new table.
INSERT INTO conversation_pins (conversation_id, message_id, pinned_at)
SELECT id, pinned_message_id, now()
FROM conversations
WHERE pinned_message_id IS NOT NULL
ON CONFLICT DO NOTHING;
