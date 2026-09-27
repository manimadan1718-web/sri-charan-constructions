/**
 * Run this ONCE to print the SQL you need to paste into Supabase SQL Editor.
 * Command: npm run setup-db
 */
require('dotenv').config();

const seedPin = process.env.SUPERVISOR_PIN || '1234';

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
  pin         TEXT NOT NULL UNIQUE,
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

-- Indexes for speed
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_vehicle ON entries(vehicle_no);
CREATE INDEX IF NOT EXISTS idx_breakup_entry ON breakup_rows(entry_id);
CREATE INDEX IF NOT EXISTS idx_users_pin ON users(pin);

-- Seed one Admin account so you can log in and create everyone else.
-- ⚠️ Change this PIN immediately after your first login (Users tab).
INSERT INTO users (name, pin, role)
VALUES ('Admin', '${seedPin}', 'admin')
ON CONFLICT (pin) DO NOTHING;
`;

console.log('\n' + '='.repeat(60));
console.log('  SUPABASE SETUP — Copy & paste the SQL below into:');
console.log('  Supabase Dashboard → SQL Editor → New Query → Run');
console.log('='.repeat(60));
console.log(SQL);
console.log('='.repeat(60));
console.log(`\n  After running it, log in with PIN "${seedPin}" — you'll land as Admin.`);
console.log('  Go to the Users tab to create your Supervisor and Owner accounts.\n');
