-- Speed admin message inspection by membership and sender.
CREATE INDEX IF NOT EXISTS idx_conversation_members_user
    ON conversation_members (user_id);

CREATE INDEX IF NOT EXISTS idx_messages_enterprise_sender_created
    ON messages (enterprise_id, sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_enterprise_conv_created
    ON messages (enterprise_id, conversation_id, created_at DESC);
