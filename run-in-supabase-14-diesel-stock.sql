-- ===================================================================================
--  Sri Charan Constructions - DIESEL STOCK RECEIVED (by date and site)
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
--
--  Each row is a delivery of diesel to a site. The usage is NOT stored here: it is read from the diesel on the entries,
--  so Balance Stock (received - used) always follows what the supervisors enter.
-- ===================================================================================
CREATE TABLE IF NOT EXISTS diesel_stock (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_date      DATE NOT NULL,                       -- the day the diesel was received
  site            TEXT NOT NULL,                       -- a site from Inventory
  litres          NUMERIC(12,2) NOT NULL CHECK (litres > 0),
  note            TEXT NOT NULL DEFAULT '',            -- optional: supplier, bill number ...
  created_by_id   TEXT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  updated_by_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_diesel_stock_site_date ON diesel_stock(site, stock_date);
ALTER TABLE diesel_stock ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it

NOTIFY pgrst, 'reload schema';                           -- makes the new table visible to the app straight away
