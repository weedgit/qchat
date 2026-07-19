-- Delete messages older than enterprise retention_days (default 90)
DELETE FROM messages m
USING enterprises e
WHERE m.enterprise_id = e.id
  AND m.created_at < now() - make_interval(days => e.retention_days);

-- Orphan media cleanup helper (run after message purge)
-- DELETE FROM media_objects WHERE created_at < now() - interval '90 days';
