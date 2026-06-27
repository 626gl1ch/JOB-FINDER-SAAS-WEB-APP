-- Run this once in the Supabase SQL Editor.
-- Safe to run even if it's already applied (IF NOT EXISTS guard).
--
-- WHY: the Stripe webhook and /api/payment/status handlers both write a
-- stripe_subscription_id field to profiles. That column never existed, only
-- stripe_customer_id did. Supabase/PostgREST rejects an UPDATE that touches
-- a nonexistent column for the ENTIRE request -- so on a real payment, the
-- current_tier upgrade to "paid" would have failed silently along with it.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Verify it worked:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'stripe_subscription_id';
-- Expect one row back: stripe_subscription_id | text
