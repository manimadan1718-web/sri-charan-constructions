-- ===================================================================================
--  Sri Charan Constructions - Payroll, part 3: salary revisions, monthly TDS amount, employee documents
--  (run ONCE in Supabase > SQL Editor > New query > Run; safe to run twice; nothing is changed or deleted)
--  Run run-in-supabase-19-payroll.sql and run-in-supabase-20-payroll-more.sql first.
-- ===================================================================================
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS tds_monthly NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payroll_revisions (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id        UUID NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  effective_from     DATE NOT NULL,
  monthly_ctc        NUMERIC(12,2) NOT NULL CHECK (monthly_ctc > 0),
  structure          TEXT NOT NULL DEFAULT 'standard',
  previous_ctc       NUMERIC(12,2) NOT NULL,
  previous_structure TEXT NOT NULL DEFAULT 'standard',
  reason             TEXT NOT NULL DEFAULT '',
  arrears_note       TEXT NOT NULL DEFAULT '',
  created_by_name    TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_payroll_rev_emp ON payroll_revisions(employee_id);
ALTER TABLE payroll_revisions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS payroll_employee_docs (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       UUID NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  doc_type          TEXT NOT NULL,
  name              TEXT NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  ext               TEXT NOT NULL DEFAULT '',
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  storage_path      TEXT NOT NULL,
  uploaded_by_name  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_docs_emp ON payroll_employee_docs(employee_id);
ALTER TABLE payroll_employee_docs ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
