-- ===================================================================================
--  Sri Charan Constructions - Renewals (insurance, permits, subscriptions ...) and their reminders
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. It does not change or delete anything that already exists.
-- ===================================================================================

-- 1. The renewals themselves
CREATE TABLE IF NOT EXISTS renewals (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  renewal_type     TEXT NOT NULL,                                             -- e.g. Vehicle Insurance, Permit, Software Subscription
  description      TEXT NOT NULL DEFAULT '',
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  renewal_date     DATE NOT NULL,                                             -- the date it must be renewed by
  paid_by          TEXT NOT NULL DEFAULT '',                                  -- who paid (typed by hand)
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'renewed')),
  renewed_on       DATE,
  renewed_by_name  TEXT,
  created_by_id    TEXT,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,
  updated_by_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_renewals_date   ON renewals(renewal_date);
CREATE INDEX IF NOT EXISTS idx_renewals_status ON renewals(status);

-- 2. The documents attached to a renewal (the files live in the private documents storage; removing a renewal removes these links)
CREATE TABLE IF NOT EXISTS renewal_files (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  renewal_id        UUID NOT NULL REFERENCES renewals(id) ON DELETE CASCADE,
  storage_path      TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  ext               TEXT NOT NULL DEFAULT '',
  size_bytes        BIGINT NOT NULL DEFAULT 0,
  uploaded_by_name  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_renewal_files_renewal ON renewal_files(renewal_id);

-- 3. One reminder per renewal per person: it is "sent" again (and shows as unread again) every time the repeat interval passes
CREATE TABLE IF NOT EXISTS renewal_alerts (
  renewal_id    UUID NOT NULL REFERENCES renewals(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'soon',
  last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at       TIMESTAMPTZ,
  times         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (renewal_id, user_id)
);

-- 4. The reminder settings the Admin chooses in the Permissions tab (start how many days before, repeat every N hours or days)
CREATE TABLE IF NOT EXISTS app_settings (
  key              TEXT PRIMARY KEY,
  value            JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_by_name  TEXT
);

ALTER TABLE renewals       ENABLE ROW LEVEL SECURITY;      -- like every other table: only the app's server can read or write them
ALTER TABLE renewal_files  ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings   ENABLE ROW LEVEL SECURITY;
