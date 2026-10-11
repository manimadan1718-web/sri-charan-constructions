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

-- 11. Photo proof for the Starting / Closing reading and the Diesel (shown in Records).
-- Only the file's path is stored here; the picture itself lives in a PRIVATE storage bucket.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS start_photo TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS close_photo TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS diesel_photo TEXT;

-- 12. Who created / edited / deleted each user (used by the downloadable Users report).
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by_name TEXT;

-- 13. Lock every table: only this app's server (secret service-role key) may read or change data.
ALTER TABLE IF EXISTS users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS breakup_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS vehicles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS operators     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS summaries     ENABLE ROW LEVEL SECURITY;
INSERT INTO storage.buckets (id, name, public)
VALUES ('reading-photos', 'reading-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 12. Loads breakup, Documents and Payments.
-- Loads breakup: an entry's Loads split by unloading point (the lines must add up to the entry's Loads — the app checks this).
CREATE TABLE IF NOT EXISTS load_points (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id    UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  point_name  TEXT NOT NULL,
  loads       INTEGER NOT NULL CHECK (loads > 0),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_load_points_entry ON load_points(entry_id);

-- Documents: work orders, tax invoices, … (the files themselves live in a PRIVATE storage bucket "documents").
CREATE TABLE IF NOT EXISTS documents (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name               TEXT NOT NULL,
  category           TEXT NOT NULL,
  original_filename  TEXT,
  ext                TEXT,
  size_bytes         BIGINT NOT NULL DEFAULT 0,
  storage_path       TEXT NOT NULL,
  sha256             TEXT NOT NULL,
  site               TEXT,
  notes              TEXT,
  uploaded_by_name   TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ,
  updated_by_name    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_sha256_unique ON documents(sha256);     -- the exact same file cannot be stored twice
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);

-- Payments: weekly (food …) and monthly (salary …). ONE line per person per period.
CREATE TABLE IF NOT EXISTS payments (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pay_type         TEXT NOT NULL CHECK (pay_type IN ('weekly', 'monthly')),
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  employee_name    TEXT NOT NULL,
  employee_key     TEXT NOT NULL,                 -- the name in lower case, so "Ravi" and "ravi " are the same person
  days_worked      NUMERIC(4,1) NOT NULL CHECK (days_worked >= 0),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_by_id    TEXT,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,
  updated_by_name  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_unique_person_period ON payments(pay_type, period_start, employee_key);   -- no duplicates, even if two people save at the same moment
CREATE INDEX IF NOT EXISTS idx_payments_period  ON payments(pay_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_payments_creator ON payments(created_by_id, created_at DESC);

-- Locked down like every other table: only this app's server (secret key) can reach them.
ALTER TABLE load_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE load_points, documents, payments FROM anon, authenticated;

-- The private bucket for documents (the app also creates it by itself on first start).
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;

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
