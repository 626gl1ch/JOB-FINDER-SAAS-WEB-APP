-- ================================================================
--  PROJECT: SNIPEJOB SAAS -- Supabase database migration
--  Run this in: Supabase Dashboard -> SQL Editor
--  Only needed if you're NOT re-running the full schema.sql (which
--  already includes this same column) -- pick one, not both.
-- ================================================================
-- ============================================================
-- MIGRATION: subscription grace-period tracking
-- Run this in the Supabase SQL Editor on your EXISTING database.
-- Safe to run multiple times (IF NOT EXISTS guard) and safe to run even if
-- you've already re-run the full updated schema.sql instead (in which case
-- this is just a no-op). Pick ONE of the two, not both, on a fresh setup.
-- ============================================================

-- Timestamp of the most recent failed/missed renewal charge. NULL means the
-- user is current (or on the free plan). See GRACE_PERIOD_EMAIL_SYSTEM_SETUP.txt
-- for the full explanation of how this column is used.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMP WITH TIME ZONE;

-- Optional but recommended: speeds up the daily sweep query
-- (runExpiryCheck() in the worker) once you have more than a handful of
-- paid users. Not required for correctness, just performance.
CREATE INDEX IF NOT EXISTS idx_profiles_payment_failed_at
ON public.profiles(payment_failed_at)
WHERE payment_failed_at IS NOT NULL;
