-- ============================================================
--  Sri Charan Constructions – User tracking
--  Run this FIRST. Paste the whole block into Supabase → SQL Editor → Run.
--  Safe to run more than once. It does not delete anything.
--
--  It adds the columns that remember WHO created, edited and deleted each user and WHEN,
--  so the downloadable Users report can show them (deleted users stay in the report only).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by_name TEXT;

-- Fill in the history we already know from the Activity Log (only where it is still empty).
UPDATE users u
   SET created_by_name = l.user_name
  FROM activity_logs l
 WHERE l.action = 'user_created' AND l.entity_type = 'user' AND l.entity_id = u.id::text
   AND u.created_by_name IS NULL AND l.user_name IS NOT NULL;

UPDATE users u
   SET updated_at = x.created_at, updated_by_name = x.user_name
  FROM (SELECT DISTINCT ON (entity_id) entity_id, created_at, user_name
          FROM activity_logs
         WHERE action = 'user_updated' AND entity_type = 'user'
         ORDER BY entity_id, created_at DESC) x
 WHERE x.entity_id = u.id::text AND u.updated_at IS NULL;

-- Make Supabase's API notice the new columns immediately.
NOTIFY pgrst, 'reload schema';
