-- ============================================================
--  Sri Charan Constructions – Database security
--  Run this AFTER the user-tracking file, and ONLY once the app is running with the SECRET
--  (service role) key — see the note below. Safe to run more than once.
--
--  What it does: every table is locked so that nobody can read or change it through Supabase's own
--  public web address using the public "anon" key. Only this app's server (which uses the secret
--  service-role key and is not affected by these locks) can reach the data.
--
--  ⚠️  BEFORE RUNNING: in Render → your service → Environment, check that SUPABASE_SERVICE_KEY is the
--  "service_role" / secret key and NOT the "anon" / "publishable" key. The new server prints a
--  warning at start-up (Render → Logs) if it looks wrong. If it IS wrong, this script would stop the app.
-- ============================================================

ALTER TABLE IF EXISTS users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS breakup_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS vehicles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS operators     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS summaries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS activity_logs ENABLE ROW LEVEL SECURITY;

-- Belt and braces: the public roles get no rights on these tables at all.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── CHECKS — run these two lines afterwards and look at the results ──────────────────────────
-- 1) Every table should say  rls_enabled = true :
--      SELECT tablename, rowsecurity AS rls_enabled FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- 2) This should say  plain_text_pins = 0  (every PIN is stored scrambled / hashed):
--      SELECT count(*) FILTER (WHERE pin !~ '^\$2[aby]\$') AS plain_text_pins FROM users;
