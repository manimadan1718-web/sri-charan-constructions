-- ===================================================================================
--  Sri Charan Constructions - the Archive (everything that is deleted is kept here until the Admin deletes it permanently)
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
-- ===================================================================================
CREATE TABLE IF NOT EXISTS archive_items (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type      TEXT NOT NULL,            -- entry, purchase, payment, renewal, renewal_file, document, progress, vehicle, operator, site
  entity_id        TEXT,                     -- the id it had before it was deleted
  label            TEXT NOT NULL,            -- what it was, in a few words
  detail           TEXT NOT NULL DEFAULT '',
  snapshot         JSONB NOT NULL,           -- a full copy: the row and the rows that belonged to it
  files            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ "bucket": "...", "path": "..." }] stored files that are removed only when it is deleted permanently
  reason           TEXT NOT NULL DEFAULT '',
  deleted_by_id    TEXT,
  deleted_by_name  TEXT,
  deleted_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archive_items_type ON archive_items(entity_type);
CREATE INDEX IF NOT EXISTS idx_archive_items_deleted_at ON archive_items(deleted_at DESC);
ALTER TABLE archive_items ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it
