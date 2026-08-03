-- Stop auto-creating company default groups for enterprises.
-- Remove any existing default company chats (members/messages cascade).

UPDATE webhooks
SET conversation_id = NULL
WHERE conversation_id IN (
  SELECT id FROM conversations WHERE is_enterprise_default = TRUE
);

DELETE FROM call_participants
WHERE call_id IN (
  SELECT cs.id
  FROM call_sessions cs
  JOIN conversations c ON c.id = cs.conversation_id
  WHERE c.is_enterprise_default = TRUE
);

DELETE FROM call_sessions
WHERE conversation_id IN (
  SELECT id FROM conversations WHERE is_enterprise_default = TRUE
);

DELETE FROM conversations
WHERE is_enterprise_default = TRUE;
