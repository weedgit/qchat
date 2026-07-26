-- Personal accounts (users.enterprise_id NULL) need social rows without a company.
ALTER TABLE friendships ALTER COLUMN enterprise_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN enterprise_id DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN enterprise_id DROP NOT NULL;
