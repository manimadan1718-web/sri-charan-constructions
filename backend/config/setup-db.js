/**
 * Run this ONCE to print the SQL you need to paste into Supabase SQL Editor.
 * Command: npm run setup-db
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');

const seedPin = process.env.SUPERVISOR_PIN || '1234';
// PINs are stored as bcrypt hashes — never as plain text.
const seedPinHash = bcrypt.hashSync(seedPin, 10);

const SQL = `
-- ============================================================
--  Sri Charan Constructions – Database Setup
--  Paste this entire block into Supabase → SQL Editor → Run
-- ============================================================

-- 1. Site log entries
CREATE TABLE IF NOT EXISTS entries (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date         DATE NOT NULL,
  vehicle_no   TEXT NOT NULL,
  start_reading TEXT,
  close_reading TEXT,
  working_hours TEXT,
  diesel        NUMERIC(8,2) DEFAULT 0,
  loads         INTEGER DEFAULT 0,
  operator      TEXT,
  remarks       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Breakup rows (linked to entries)
CREATE TABLE IF NOT EXISTS breakup_rows (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id    UUID REFERENCES entries(id) ON DELETE CASCADE,
  description TEXT,
  quantity    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Manual summaries
CREATE TABLE IF NOT EXISTS summaries (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period       TEXT NOT NULL,
  total_diesel NUMERIC(10,2) DEFAULT 0,
  total_hours  TEXT,
  total_loads  INTEGER DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Users (Supervisor / Owner / Admin — each logs in with their own PIN)
CREATE TABLE IF NOT EXISTS users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  pin         TEXT NOT NULL,          -- bcrypt hash (uniqueness is enforced by the API)
  role        TEXT NOT NULL CHECK (role IN ('supervisor','owner','admin')),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Inventory — Vehicles / Machines (dropdown source for Data Entry)
CREATE TABLE IF NOT EXISTS vehicles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_no  TEXT NOT NULL UNIQUE,
  type        TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Inventory — Operators / Drivers (dropdown source for Data Entry)
CREATE TABLE IF NOT EXISTS operators (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Inventory — Sites (dropdown source for Data Entry)
CREATE TABLE IF NOT EXISTS sites (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  location    TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Entries — Site + Category (Own vehicle vs Rental).
-- Safe to re-run: adds these columns only if they don't already exist,
-- so running this whole script again on a database you already set up
-- just adds what's missing without touching your existing data.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS site TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'own' CHECK (category IN ('own','rental'));

-- 9. Self-heal older databases: if a table was created by an earlier version
-- of this script, add any columns it is missing. Safe to re-run any time.
ALTER TABLE vehicles  ADD COLUMN IF NOT EXISTS type       TEXT;
ALTER TABLE vehicles  ADD COLUMN IF NOT EXISTS active     BOOLEAN DEFAULT true;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS phone      TEXT;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS active     BOOLEAN DEFAULT true;
ALTER TABLE sites     ADD COLUMN IF NOT EXISTS location   TEXT;
ALTER TABLE sites     ADD COLUMN IF NOT EXISTS active     BOOLEAN DEFAULT true;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS active     BOOLEAN DEFAULT true;

-- 10. Activity / audit log — who did what, when, and why.
CREATE TABLE IF NOT EXISTS activity_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  user_id       TEXT,
  user_name     TEXT,
  user_role     TEXT,
  category      TEXT NOT NULL,      -- auth | entry | summary | inventory | user
  action        TEXT NOT NULL,      -- e.g. login, entry_updated, vehicle_added
  entity_type   TEXT,
  entity_id     TEXT,
  entity_label  TEXT,
  reason        TEXT,               -- required (10+ chars) when an entry is edited / deleted
  changes       JSONB,              -- [{ field, from, to }]
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_created  ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_entity   ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_logs_category ON activity_logs(category);
-- Only the server (service key) may touch the log; nothing reaches it from the browser directly.
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Indexes for speed
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_vehicle ON entries(vehicle_no);
CREATE INDEX IF NOT EXISTS idx_entries_site ON entries(site);
CREATE INDEX IF NOT EXISTS idx_breakup_entry ON breakup_rows(entry_id);

-- Seed one Admin account so you can log in and create everyone else.
-- Only inserted when no admin exists yet, so re-running this script never
-- creates duplicate admins.
-- ⚠️ Change this PIN immediately after your first login (Users tab).
INSERT INTO users (name, pin, role)
SELECT 'Admin', '${seedPinHash}', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');

-- Make Supabase's API notice the new columns immediately.
NOTIFY pgrst, 'reload schema';
`;

console.log('\n' + '='.repeat(60));
console.log('  SUPABASE SETUP — Copy & paste the SQL below into:');
console.log('  Supabase Dashboard → SQL Editor → New Query → Run');
console.log('='.repeat(60));
console.log(SQL);
console.log('='.repeat(60));
console.log(`\n  After running it, log in with PIN "${seedPin}" — you'll land as Admin.`);
console.log('  Go to the Users tab to create your Supervisor and Owner accounts.\n');
