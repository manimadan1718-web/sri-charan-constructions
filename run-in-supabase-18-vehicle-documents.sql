-- ===================================================================================
--  Sri Charan Constructions - Vehicle documents (Insurance, Permit, Tax, FC, PUCC) and Registration date
--  (run ONCE in Supabase > SQL Editor > New query > Run; safe to run twice; nothing is changed or deleted)
-- ===================================================================================

-- 1. Each vehicle's registration date lives on the vehicle itself
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_date DATE;

-- 2. A vehicle document is an ordinary renewal (so reminders, the bell, "renewed" and the activity log all work),
--    linked to its vehicle and told which document it is (insurance / permit / tax / fc / pucc)
ALTER TABLE renewals ADD COLUMN IF NOT EXISTS vehicle_id TEXT;
ALTER TABLE renewals ADD COLUMN IF NOT EXISTS doc_kind   TEXT;
CREATE INDEX IF NOT EXISTS idx_renewals_vehicle ON renewals(vehicle_id, doc_kind);

-- 3. At most ONE not-yet-renewed row per vehicle per document
CREATE UNIQUE INDEX IF NOT EXISTS uq_renewals_vehicle_doc_active
  ON renewals(vehicle_id, doc_kind) WHERE status = 'active' AND doc_kind IS NOT NULL;

NOTIFY pgrst, 'reload schema';
