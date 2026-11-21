-- ===================================================================================
--  Sri Charan Constructions - Payroll (employees, attendance, monthly payroll, pay slips)
--  (run ONCE in Supabase > SQL Editor > New query > Run; safe to run twice; nothing is changed or deleted)
--  The payroll settings are kept in the existing app_settings table (run-in-supabase-9-renewals.sql made it).
-- ===================================================================================

-- 1. Employees
CREATE TABLE IF NOT EXISTS payroll_employees (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  emp_code         TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  designation      TEXT NOT NULL DEFAULT '',
  site             TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  address          TEXT NOT NULL DEFAULT '',
  emergency_name   TEXT NOT NULL DEFAULT '',
  emergency_phone  TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  joined_on        DATE NOT NULL,
  left_on          DATE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  monthly_ctc      NUMERIC(12,2) NOT NULL CHECK (monthly_ctc > 0),
  structure        TEXT NOT NULL DEFAULT 'standard',
  pf_applicable    BOOLEAN NOT NULL DEFAULT TRUE,
  esi_applicable   BOOLEAN NOT NULL DEFAULT TRUE,
  pt_applicable    BOOLEAN NOT NULL DEFAULT TRUE,
  bank_name        TEXT NOT NULL DEFAULT '',
  bank_account     TEXT NOT NULL DEFAULT '',
  ifsc             TEXT NOT NULL DEFAULT '',
  pan              TEXT NOT NULL DEFAULT '',
  uan              TEXT NOT NULL DEFAULT '',
  esi_no           TEXT NOT NULL DEFAULT '',
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_by_name  TEXT,
  updated_at       TIMESTAMPTZ
);

-- 2. Attendance: one row per employee per day (a day with no row is "not marked")
CREATE TABLE IF NOT EXISTS payroll_attendance (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id  UUID NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  att_date     DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('P', 'A', 'H', 'L', 'W')),
  ot_hours     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (ot_hours >= 0 AND ot_hours <= 24),
  note         TEXT NOT NULL DEFAULT '',
  marked_by_name TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, att_date)
);
CREATE INDEX IF NOT EXISTS idx_payroll_att_date ON payroll_attendance(att_date);

-- 3. One row per month: its status and whether attendance is locked
CREATE TABLE IF NOT EXISTS payroll_months (
  month              TEXT PRIMARY KEY,                     -- 'YYYY-MM'
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'finalised', 'paid')),
  attendance_locked  BOOLEAN NOT NULL DEFAULT FALSE,
  finalised_by_name  TEXT,
  finalised_at       TIMESTAMPTZ,
  paid_by_name       TEXT,
  paid_at            TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 4. One row per employee per month: bonus / deduction lines, and (once finalised) the final figures and pay slip
CREATE TABLE IF NOT EXISTS payroll_lines (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month        TEXT NOT NULL,
  employee_id  UUID NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  adjustments  JSONB NOT NULL DEFAULT '[]'::jsonb,
  data         JSONB,                                      -- the final figures, saved when the month is finalised
  payslip_at   TIMESTAMPTZ,
  UNIQUE (month, employee_id)
);

ALTER TABLE payroll_employees  ENABLE ROW LEVEL SECURITY;   -- like every other table: only the app's server can read or write them
ALTER TABLE payroll_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_months     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines      ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
