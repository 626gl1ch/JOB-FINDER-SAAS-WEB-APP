-- SnipeJob Supabase Database Schema (Consolidated Complete Version)

-- ============================================================
-- 0. EXTENSIONS & INITIAL SETUP
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant usage on cron schema so postgres role can manage cron tasks
GRANT USAGE ON SCHEMA cron TO postgres;

-- ============================================================
-- 1. DATABASE TABLES
-- ============================================================

-- 1.1 User Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    country TEXT,
    sectors TEXT[] DEFAULT '{}',
    verified_phone TEXT DEFAULT '',
    id_status TEXT CHECK (id_status IN ('unverified', 'pending', 'verified', 'flagged')) DEFAULT 'unverified',
    id_image_url TEXT,
    exp_level TEXT CHECK (exp_level IN ('junior', 'mid', 'senior', 'expert')) DEFAULT 'mid',
    primary_skill TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    education TEXT DEFAULT '',
    current_tier TEXT CHECK (current_tier IN ('free', 'paid')) DEFAULT 'free',
    subscription_expiry TIMESTAMP WITH TIME ZONE,
    wallet_balance DECIMAL(12,2) DEFAULT 0.00 CHECK (wallet_balance >= 0),
    preferred_payout_address TEXT,
    vpn_violation_count INT DEFAULT 0,
    avatar_url TEXT,
    oauth_provider TEXT DEFAULT 'email',
    stripe_customer_id TEXT,      -- kept for data continuity; new signups use paystack_customer_code
    stripe_subscription_id TEXT,   -- kept for data continuity; new signups use paystack_subscription_code
    paystack_customer_code TEXT,
    paystack_subscription_code TEXT,
    plan_type TEXT CHECK (plan_type IN ('monthly', 'annual')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Retrofit database checks and columns if profiles already existed
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='full_name') THEN
        ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='country') THEN
        ALTER TABLE public.profiles ADD COLUMN country TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='sectors') THEN
        ALTER TABLE public.profiles ADD COLUMN sectors TEXT[] DEFAULT '{}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='id_status') THEN
        ALTER TABLE public.profiles ADD COLUMN id_status TEXT DEFAULT 'unverified';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='exp_level') THEN
        ALTER TABLE public.profiles ADD COLUMN exp_level TEXT DEFAULT 'mid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='primary_skill') THEN
        ALTER TABLE public.profiles ADD COLUMN primary_skill TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='bio') THEN
        ALTER TABLE public.profiles ADD COLUMN bio TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='education') THEN
        ALTER TABLE public.profiles ADD COLUMN education TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='avatar_url') THEN
        ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='oauth_provider') THEN
        ALTER TABLE public.profiles ADD COLUMN oauth_provider TEXT DEFAULT 'email';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='stripe_customer_id') THEN
        ALTER TABLE public.profiles ADD COLUMN stripe_customer_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='plan_type') THEN
        ALTER TABLE public.profiles ADD COLUMN plan_type TEXT CHECK (plan_type IN ('monthly', 'annual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='signup_source') THEN
        ALTER TABLE public.profiles ADD COLUMN signup_source TEXT DEFAULT 'app';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='stripe_subscription_id') THEN
        ALTER TABLE public.profiles ADD COLUMN stripe_subscription_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='expiry_warning_sent') THEN
        ALTER TABLE public.profiles ADD COLUMN expiry_warning_sent BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='paystack_customer_code') THEN
        ALTER TABLE public.profiles ADD COLUMN paystack_customer_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='paystack_subscription_code') THEN
        ALTER TABLE public.profiles ADD COLUMN paystack_subscription_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_wallet_balance_check') THEN
        ALTER TABLE public.profiles ADD CONSTRAINT profiles_wallet_balance_check CHECK (wallet_balance >= 0);
    END IF;
END $$;

-- 1.2 Job Repository Table
CREATE TABLE IF NOT EXISTS public.scraped_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    sector TEXT CHECK (sector IN ('web', 'data', 'video', 'design', 'ai', 'writing', 'mobile', 'cyber', 'marketing', 'support', 'va', 'sales', 'mgmt', 'finance', 'legal', 'other')) NOT NULL,
    listing_source TEXT NOT NULL,
    job_url TEXT UNIQUE NOT NULL,
    payload_description TEXT NOT NULL,
    internal_labels TEXT[] DEFAULT '{}',
    indexed_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.3 User Pinned Jobs Table
CREATE TABLE IF NOT EXISTS public.user_pinned_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    job_id UUID REFERENCES public.scraped_jobs(id) ON DELETE CASCADE NOT NULL,
    system_status TEXT CHECK (system_status IN ('pinned', 'in_progress', 'completed')) DEFAULT 'pinned',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, job_id)
);

-- 1.4 Affiliate Logs Table
CREATE TABLE IF NOT EXISTS public.affiliate_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    tracking_subid TEXT UNIQUE NOT NULL,
    incoming_network_provider TEXT NOT NULL,
    full_raw_payout DECIMAL(10,4) NOT NULL,
    user_credited_amount DECIMAL(10,4) NOT NULL,
    validation_ip TEXT NOT NULL,
    processing_timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.5 Withdrawal Requests Table
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    payment_channel TEXT NOT NULL,
    target_address TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'disbursed', 'denied')) DEFAULT 'pending',
    tier_at_request TEXT DEFAULT 'free',
    scheduled_payout_date DATE,
    handled_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Retrofit withdrawal_requests columns if table already existed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='tier_at_request') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN tier_at_request TEXT DEFAULT 'free';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='scheduled_payout_date') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN scheduled_payout_date DATE;
    END IF;
END $$;

-- 1.6 Claimed Paystack Sessions Table (replaces claimed_stripe_sessions)
-- claimed_stripe_sessions is kept in production for historical data but no longer written to.
CREATE TABLE IF NOT EXISTS public.claimed_paystack_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.claimed_paystack_sessions ENABLE ROW LEVEL SECURITY;

-- 1.7 Interview Sessions Table (New)
CREATE TABLE IF NOT EXISTS public.interview_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    job_id UUID REFERENCES public.scraped_jobs(id) ON DELETE SET NULL,
    sector TEXT,
    tier_at_time TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.8 Interview Answers Table (New)
CREATE TABLE IF NOT EXISTS public.interview_answers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES public.interview_sessions(id) ON DELETE CASCADE NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    score INT,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.9 Sector Trends Table (New)
CREATE TABLE IF NOT EXISTS public.sector_trends (
    sector TEXT PRIMARY KEY,
    trending_skills TEXT[] DEFAULT '{}',
    recommended_certs TEXT[] DEFAULT '{}',
    summary TEXT DEFAULT '',
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================
-- 2. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_sector ON public.scraped_jobs(sector);
CREATE INDEX IF NOT EXISTS idx_jobs_indexed_at ON public.scraped_jobs(indexed_at);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(id_status);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON public.profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_expiry ON public.profiles(subscription_expiry);

-- ============================================================
-- 3. TRIGGERS AND FUNCTIONS
-- ============================================================

-- 3.1 handle_new_user Trigger Function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_sectors TEXT[] := '{}';
    v_sectors_json JSONB;
    v_exp_level TEXT := 'mid';
    v_raw_exp TEXT;
BEGIN
    -- Safely parse sectors array — crashes on NULL/invalid JSONB without this guard
    BEGIN
        v_sectors_json := NEW.raw_user_meta_data->'sectors';
        IF v_sectors_json IS NOT NULL AND jsonb_typeof(v_sectors_json) = 'array' THEN
            SELECT ARRAY(SELECT jsonb_array_elements_text(v_sectors_json)) INTO v_sectors;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_sectors := '{}';
    END;

    -- Safely validate exp_level against the CHECK constraint
    v_raw_exp := NEW.raw_user_meta_data->>'exp_level';
    IF v_raw_exp IN ('junior', 'mid', 'senior', 'expert') THEN
        v_exp_level := v_raw_exp;
    ELSE
        v_exp_level := 'mid';
    END IF;

    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        country,
        sectors,
        exp_level,
        primary_skill,
        bio,
        education,
        avatar_url,
        oauth_provider
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        COALESCE(NEW.raw_user_meta_data->>'country', NULL),
        v_sectors,
        v_exp_level,
        COALESCE(NEW.raw_user_meta_data->>'primary_skill', ''),
        COALESCE(NEW.raw_user_meta_data->>'bio', ''),
        COALESCE(NEW.raw_user_meta_data->>'education', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', NULL),
        COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3.2 Affiliate Credit RPC
CREATE OR REPLACE FUNCTION process_affiliate_credit(
    target_user_id UUID, 
    sub_id TEXT, 
    provider TEXT, 
    raw_payout DECIMAL, 
    user_cut DECIMAL, 
    ip_addr TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.affiliate_logs (user_id, tracking_subid, incoming_network_provider, full_raw_payout, user_credited_amount, validation_ip)
    VALUES (target_user_id, sub_id, provider, raw_payout, user_cut, ip_addr);

    UPDATE public.profiles 
    SET wallet_balance = wallet_balance + user_cut 
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3.3 Withdrawal Process RPC (Legacy - Paid only)
CREATE OR REPLACE FUNCTION process_withdrawal(
    p_user_id UUID, p_amount DECIMAL, p_channel TEXT, p_address TEXT
) RETURNS VOID AS $$
DECLARE
    v_tier TEXT;
    v_updated INT;
BEGIN
    SELECT current_tier INTO v_tier FROM public.profiles WHERE id = p_user_id;
    IF v_tier IS DISTINCT FROM 'paid' THEN
        RAISE EXCEPTION 'Pro subscription required for withdrawals';
    END IF;

    UPDATE public.profiles
    SET wallet_balance = wallet_balance - p_amount
    WHERE id = p_user_id AND wallet_balance >= p_amount;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    INSERT INTO public.withdrawal_requests (user_id, total_amount, payment_channel, target_address, status)
    VALUES (p_user_id, p_amount, p_channel, p_address, 'pending');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3.4 Withdrawal Process RPC v2 (Atomic — works for Free and Pro)
CREATE OR REPLACE FUNCTION process_withdrawal_v2(
    p_user_id UUID, p_amount DECIMAL, p_channel TEXT, p_address TEXT,
    p_tier TEXT, p_scheduled_date DATE
) RETURNS VOID AS $$
DECLARE
    v_updated INT;
BEGIN
    UPDATE public.profiles
    SET wallet_balance = wallet_balance - p_amount
    WHERE id = p_user_id AND wallet_balance >= p_amount;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    INSERT INTO public.withdrawal_requests
        (user_id, total_amount, payment_channel, target_address, status, tier_at_request, scheduled_payout_date)
    VALUES
        (p_user_id, p_amount, p_channel, p_address, 'pending', p_tier, p_scheduled_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3.5 Subscription Expiry Checker RPC
CREATE OR REPLACE FUNCTION public.check_subscription_expiry()
RETURNS void AS $$
DECLARE
    rec RECORD;
    worker_url TEXT := 'https://my-sniper-worker.daniellancce1.workers.dev';
    internal_secret TEXT := current_setting('app.worker_internal_secret', true);
BEGIN
    -- 1. Send 3-day expiry warnings to paid users approaching their expiry date
    FOR rec IN
        SELECT id, email, full_name, subscription_expiry, plan_type
        FROM public.profiles
        WHERE current_tier = 'paid'
          AND subscription_expiry IS NOT NULL
          AND subscription_expiry <= (NOW() + INTERVAL '3 days')
          AND subscription_expiry > NOW()
          AND (expiry_warning_sent IS NULL OR expiry_warning_sent = FALSE)
    LOOP
        -- POST to the Worker's internal email endpoint
        PERFORM net.http_post(
            url     := worker_url || '/api/internal/send-expiry-email',
            body    := json_build_object(
                           'user_id',     rec.id,
                           'email',       rec.email,
                           'full_name',   rec.full_name,
                           'expiry_date', rec.subscription_expiry,
                           'plan_type',   rec.plan_type
                       )::text,
            headers := json_build_object(
                           'Content-Type',       'application/json',
                           'X-Internal-Secret',  internal_secret
                       )::jsonb
        );

        -- Mark warned so we don't email them again this cycle
        UPDATE public.profiles SET expiry_warning_sent = TRUE WHERE id = rec.id;
    END LOOP;

    -- 2. Downgrade accounts whose subscription has fully expired
    UPDATE public.profiles
    SET current_tier       = 'free',
        expiry_warning_sent = FALSE   -- reset so warning arms again if they resubscribe
    WHERE current_tier = 'paid'
      AND subscription_expiry IS NOT NULL
      AND subscription_expiry < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. ROW LEVEL SECURITY (RLS) & POLICIES
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pinned_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claimed_stripe_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_trends ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile') THEN
        CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile') THEN
        CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own pinned jobs') THEN
        CREATE POLICY "Users can view their own pinned jobs" ON public.user_pinned_jobs FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage their own pinned jobs') THEN
        CREATE POLICY "Users can manage their own pinned jobs" ON public.user_pinned_jobs FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own withdrawal requests') THEN
        CREATE POLICY "Users can view their own withdrawal requests" ON public.withdrawal_requests FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can create withdrawal requests') THEN
        CREATE POLICY "Users can create withdrawal requests" ON public.withdrawal_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read access for jobs') THEN
        CREATE POLICY "Public read access for jobs" ON public.scraped_jobs FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own interview sessions') THEN
        CREATE POLICY "Users can view their own interview sessions" ON public.interview_sessions FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can create their own interview sessions') THEN
        CREATE POLICY "Users can create their own interview sessions" ON public.interview_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view answers in their own sessions') THEN
        CREATE POLICY "Users can view answers in their own sessions" ON public.interview_answers FOR SELECT USING (
            EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert answers in their own sessions') THEN
        CREATE POLICY "Users can insert answers in their own sessions" ON public.interview_answers FOR INSERT WITH CHECK (
            EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read access for sector trends') THEN
        CREATE POLICY "Public read access for sector trends" ON public.sector_trends FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own affiliate logs') THEN
        CREATE POLICY "Users can view their own affiliate logs" ON public.affiliate_logs FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 5. CRON SCHEDULING
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snipejob-subscription-expiry-check') THEN
        PERFORM cron.unschedule('snipejob-subscription-expiry-check');
    END IF;
END $$;

SELECT cron.schedule(
    'snipejob-subscription-expiry-check',   -- job name (unique)
    '0 8 * * *',                            -- every day at 08:00 UTC
    'SELECT public.check_subscription_expiry();'
);
