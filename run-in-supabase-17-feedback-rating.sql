-- ===================================================================================
--  Sri Charan Constructions - star rating (1 to 5) on Feedback
--  (run ONCE in Supabase > SQL Editor > New query > Run; safe to run twice)
-- ===================================================================================
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5);
NOTIFY pgrst, 'reload schema';
