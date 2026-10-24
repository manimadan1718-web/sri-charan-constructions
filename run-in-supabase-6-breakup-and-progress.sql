-- ===================================================================================
--  Sri Charan Constructions - Loads breakup details + Site Working Progress images
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
-- ===================================================================================

-- 1. Loads breakup: each line now also has a material, a location and a rate.
--    (Amount = Loads x Rate is always worked out from these, never stored, so it can never go out of step.)
ALTER TABLE load_points ADD COLUMN IF NOT EXISTS material TEXT          NOT NULL DEFAULT '';
ALTER TABLE load_points ADD COLUMN IF NOT EXISTS location TEXT          NOT NULL DEFAULT '';
ALTER TABLE load_points ADD COLUMN IF NOT EXISTS rate     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (rate >= 0);
ALTER TABLE load_points ADD COLUMN IF NOT EXISTS position INTEGER       NOT NULL DEFAULT 0;   -- the order the lines were typed in (Sl No)

-- 2. Site Working Progress images. The pictures themselves live in the private photo storage (folder "progress/");
--    this table only remembers which entry each belongs to, its caption and who added it.
CREATE TABLE IF NOT EXISTS progress_photos (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id         UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  storage_path     TEXT NOT NULL,
  caption          TEXT NOT NULL DEFAULT '',
  uploaded_by_id   TEXT,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS progress_photos_path_unique ON progress_photos(storage_path);   -- one picture is used once
CREATE INDEX IF NOT EXISTS idx_progress_photos_entry ON progress_photos(entry_id);
ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it
