-- Allow media uploads before a user joins an enterprise (personal avatars, etc.).
ALTER TABLE media_objects ALTER COLUMN enterprise_id DROP NOT NULL;
