-- ===================================================================================
--  Sri Charan Constructions - Feedback (Menu > Feedback): suggestions, problems and questions sent by the users
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
-- ===================================================================================
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT,
  user_name   TEXT,
  user_role   TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('suggestion', 'problem', 'question')),
  message     TEXT NOT NULL,
  page        TEXT NOT NULL DEFAULT '',          -- the screen the person was on
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write it

NOTIFY pgrst, 'reload schema';
