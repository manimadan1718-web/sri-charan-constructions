-- ═══════════════════════════════════════════════════════════════════════════════
-- Sri Charan Constructions — language choice (English, Hindi, Telugu, Kannada, Tamil)
-- Run ONCE in Supabase: SQL Editor → New query → paste this → Run. It is safe to run twice.
--
-- It lets each person's chosen language follow them to a new phone. Until it is run, the language still works:
-- each phone just remembers its own choice.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_language_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_language_check CHECK (language IS NULL OR language IN ('en', 'hi', 'te', 'kn', 'ta'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';          -- makes the new column visible to the app straight away
