-- ===================================================================================
--  Sri Charan Constructions - Payments ledger: Company Payments and Outside Rental Payments
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
--  (The older weekly / monthly "payments" table is left exactly as it is - nothing is deleted.)
-- ===================================================================================
CREATE TABLE IF NOT EXISTS payment_lines (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('company', 'outside')),       -- who we are paying
  pay_date         DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date),   -- the date of the line (chosen on a calendar)
  party_name       TEXT NOT NULL,
  party_key        TEXT NOT NULL,                                              -- the name in lower case, for grouping
  item             TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  payable          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (payable >= 0),
  paid             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid >= 0),         -- Balance = Payable - Paid is always worked out, never stored
  paid_by          TEXT NOT NULL DEFAULT '',                                   -- typed by hand: who made the payment
  created_by_id    TEXT,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,
  updated_by_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_lines_kind_party ON payment_lines(kind, party_key);
CREATE INDEX IF NOT EXISTS idx_payment_lines_created_by ON payment_lines(created_by_id);
ALTER TABLE payment_lines ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it
