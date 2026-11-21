-- ===================================================================================
--  Sri Charan Constructions - Payroll, part 2: advances and loans, WhatsApp "shared" status, payment details
--  (run ONCE in Supabase > SQL Editor > New query > Run; safe to run twice; nothing is changed or deleted)
--  Run run-in-supabase-19-payroll.sql first.
-- ===================================================================================
ALTER TABLE payroll_lines  ADD COLUMN IF NOT EXISTS shared_at   TIMESTAMPTZ;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS paid_on     DATE;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS pay_mode    TEXT;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS pay_ref     TEXT;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS pay_remarks TEXT;

CREATE TABLE IF NOT EXISTS payroll_loans (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id     UUID NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('advance', 'loan')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  instalments     INTEGER NOT NULL CHECK (instalments BETWEEN 1 AND 60),
  emi             NUMERIC(12,2) NOT NULL,
  given_on        DATE NOT NULL,
  first_month     TEXT NOT NULL,                           -- 'YYYY-MM'
  note            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closed_reason   TEXT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_loans_emp ON payroll_loans(employee_id);
ALTER TABLE payroll_loans ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
