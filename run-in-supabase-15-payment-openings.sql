-- ===================================================================================
--  Sri Charan Constructions - Payments Party Ledger: manual Opening Balances (Tally style, Cr / Dr)
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
--  An opening balance is an amount already owed (Cr) or paid in advance (Dr) to a party "as on" a date.
-- ===================================================================================
CREATE TABLE IF NOT EXISTS payment_openings (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('company', 'outside')),
  party_name       TEXT NOT NULL,
  party_key        TEXT NOT NULL,                                       -- the name in lower case, for grouping
  as_on            DATE NOT NULL,                                       -- the balance is brought forward as on this date
  side             TEXT NOT NULL CHECK (side IN ('cr', 'dr')),          -- cr = we owe the party, dr = we paid in advance
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note             TEXT NOT NULL DEFAULT '',
  created_by_id    TEXT,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_openings_party ON payment_openings(party_key, as_on);
ALTER TABLE payment_openings ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it

NOTIFY pgrst, 'reload schema';
