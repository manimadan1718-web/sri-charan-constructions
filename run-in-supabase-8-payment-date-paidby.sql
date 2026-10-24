-- ===================================================================================
--  Sri Charan Constructions - Payments: a Date on every line, and "Paid By"
--  (run ONCE in Supabase > SQL Editor > New query > Run)
--  Safe to run twice. Lines you have already saved keep everything; each one gets the
--  date it was saved on (you can change it afterwards with Edit).
-- ===================================================================================
ALTER TABLE payment_lines ADD COLUMN IF NOT EXISTS pay_date DATE;
UPDATE payment_lines SET pay_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date WHERE pay_date IS NULL;
ALTER TABLE payment_lines ALTER COLUMN pay_date SET DEFAULT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date);
ALTER TABLE payment_lines ALTER COLUMN pay_date SET NOT NULL;
ALTER TABLE payment_lines ADD COLUMN IF NOT EXISTS paid_by TEXT NOT NULL DEFAULT '';        -- typed by hand: who made the payment
CREATE INDEX IF NOT EXISTS idx_payment_lines_date ON payment_lines(pay_date);
