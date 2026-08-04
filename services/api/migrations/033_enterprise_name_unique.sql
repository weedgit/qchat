-- Deduplicate enterprise display names (case-insensitive) and enforce uniqueness.
-- Keep the oldest row per name; suffix later rows with their invite code.

WITH ranked AS (
  SELECT
    id,
    name,
    invite_code,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(name))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM enterprises
)
UPDATE enterprises AS e
SET name = trim(e.name) || ' (' || e.invite_code || ')'
FROM ranked AS r
WHERE e.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS enterprises_name_lower_uidx
  ON enterprises (lower(trim(name)));

COMMENT ON COLUMN enterprises.name IS 'Unique display name (case-insensitive).';
