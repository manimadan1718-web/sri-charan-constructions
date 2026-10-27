-- ===================================================================================
--  Sri Charan Constructions - ONE loads breakup for each DAY (and site)
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
--
--  The day's lines (unloading point, material, location, loads, rate) must add up to ALL the loads
--  the vehicles carried that day at that site. Older per-vehicle breakups are kept as they are.
-- ===================================================================================
CREATE TABLE IF NOT EXISTS day_load_points (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date      DATE NOT NULL,
  site           TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 1,          -- the order the lines were typed in (Sl No)
  point_name     TEXT NOT NULL,                       -- the unloading point
  material       TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  loads          INTEGER NOT NULL CHECK (loads > 0),
  rate           NUMERIC(12,2) NOT NULL DEFAULT 0,
  saved_by_id    TEXT,
  saved_by_name  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_day_load_points_day ON day_load_points(work_date, site);
ALTER TABLE day_load_points ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it

NOTIFY pgrst, 'reload schema';                              -- makes the new table visible to the app straight away
