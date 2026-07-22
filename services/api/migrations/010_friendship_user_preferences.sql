-- Friend aliases and tags are private to the viewer (preferences).
-- friendships.note remains the friend-request message; display aliases live here.
CREATE TABLE IF NOT EXISTS friendship_user_preferences (
    friendship_id UUID NOT NULL REFERENCES friendships(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (friendship_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_friendship_user_preferences_user
    ON friendship_user_preferences(user_id);

-- Preserve existing shared aliases for both users; future edits are independent.
INSERT INTO friendship_user_preferences(friendship_id, user_id, note, tags)
SELECT id, requester_id, COALESCE(note, ''), COALESCE(tags, '{}')
FROM friendships
WHERE status = 'accepted'
ON CONFLICT (friendship_id, user_id) DO NOTHING;

INSERT INTO friendship_user_preferences(friendship_id, user_id, note, tags)
SELECT id, addressee_id, COALESCE(note, ''), COALESCE(tags, '{}')
FROM friendships
WHERE status = 'accepted'
ON CONFLICT (friendship_id, user_id) DO NOTHING;
