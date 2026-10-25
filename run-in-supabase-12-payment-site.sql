-- ═══════════════════════════════════════════════════════════════════════════════
-- Sri Charan Constructions — a SITE on every payment line (Company and Outside Rental ledgers)
-- Run ONCE in Supabase: SQL Editor → New query → paste this → Run. It is safe to run twice.
--
-- Old lines keep an empty site (shown as "–" and findable with the filter "(not entered)").
-- Until this is run, payments still work exactly as before; only choosing a Site needs it.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE payment_lines ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';          -- makes the new column visible to the app straight away
