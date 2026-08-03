-- Remove personal accounts completely; enterprise membership is required.

-- Dependent rows that do not CASCADE from users.
DELETE FROM call_participants
WHERE user_id IN (SELECT id FROM users WHERE enterprise_id IS NULL)
   OR invited_by IN (SELECT id FROM users WHERE enterprise_id IS NULL)
   OR call_id IN (
        SELECT cs.id FROM call_sessions cs
        WHERE cs.initiator_id IN (SELECT id FROM users WHERE enterprise_id IS NULL)
           OR cs.conversation_id IN (
                SELECT id FROM conversations
                WHERE enterprise_id IS NULL
                   OR owner_id IN (SELECT id FROM users WHERE enterprise_id IS NULL)
           )
   );

DELETE FROM call_sessions
WHERE initiator_id IN (SELECT id FROM users WHERE enterprise_id IS NULL)
   OR conversation_id IN (
        SELECT id FROM conversations
        WHERE enterprise_id IS NULL
           OR owner_id IN (SELECT id FROM users WHERE enterprise_id IS NULL)
   );

UPDATE webhooks SET conversation_id = NULL
WHERE conversation_id IN (SELECT id FROM conversations WHERE enterprise_id IS NULL);

DELETE FROM messages
WHERE enterprise_id IS NULL
   OR sender_id IN (SELECT id FROM users WHERE enterprise_id IS NULL);

DELETE FROM media_objects
WHERE enterprise_id IS NULL
   OR storage_key LIKE 'personal/%'
   OR uploader_id IN (SELECT id FROM users WHERE enterprise_id IS NULL);

DELETE FROM friendships
WHERE enterprise_id IS NULL
   OR requester_id IN (SELECT id FROM users WHERE enterprise_id IS NULL)
   OR addressee_id IN (SELECT id FROM users WHERE enterprise_id IS NULL);

DELETE FROM conversations
WHERE enterprise_id IS NULL
   OR owner_id IN (SELECT id FROM users WHERE enterprise_id IS NULL);

DELETE FROM users WHERE enterprise_id IS NULL;

-- Safety: drop any remaining NULL-tenant social/media rows.
DELETE FROM messages WHERE enterprise_id IS NULL;
DELETE FROM friendships WHERE enterprise_id IS NULL;
DELETE FROM conversations WHERE enterprise_id IS NULL;
DELETE FROM media_objects WHERE enterprise_id IS NULL OR storage_key LIKE 'personal/%';

ALTER TABLE users ALTER COLUMN enterprise_id SET NOT NULL;
ALTER TABLE friendships ALTER COLUMN enterprise_id SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN enterprise_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN enterprise_id SET NOT NULL;
ALTER TABLE media_objects ALTER COLUMN enterprise_id SET NOT NULL;
