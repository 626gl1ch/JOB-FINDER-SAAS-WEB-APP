-- SnipeJob Supabase Database Schema (Final Fixed Version)

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USER PROFILES TABLE
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
    wallet_balance DECIMAL(12,2) DEFAULT 0.00,
    preferred_payout_address TEXT,
    vpn_violation_count INT DEFAULT 0,
    avatar_url TEXT,
    oauth_provider TEXT DEFAULT 'email',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Migration: add missing columns if table already existed
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
    -- Remove NOT NULL constraint from country if it exists
    BEGIN
        ALTER TABLE public.profiles ALTER COLUMN country DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    -- Migrate old column names
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='tracks_selected') THEN
        UPDATE public.profiles SET sectors = tracks_selected WHERE sectors = '{}' OR sectors IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='registered_country') THEN
        UPDATE public.profiles SET country = registered_country WHERE country IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='identity_status') THEN
        UPDATE public.profiles SET id_status = identity_status WHERE id_status = 'unverified';
    END IF;
END $$;

-- 2. JOB REPOSITORY TABLE
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

-- 3. USER PINNED JOBS
CREATE TABLE IF NOT EXISTS public.user_pinned_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    job_id UUID REFERENCES public.scraped_jobs(id) ON DELETE CASCADE NOT NULL,
    system_status TEXT CHECK (system_status IN ('pinned', 'in_progress', 'completed')) DEFAULT 'pinned',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, job_id)
);

-- 4. AFFILIATE LOGS
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

-- 5. WITHDRAWAL REQUESTS
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    payment_channel TEXT NOT NULL,
    target_address TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'disbursed', 'denied')) DEFAULT 'pending',
    handled_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_jobs_sector ON public.scraped_jobs(sector);
CREATE INDEX IF NOT EXISTS idx_jobs_indexed_at ON public.scraped_jobs(indexed_at);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(id_status);

-- ============================================================
-- THE CRITICAL FIX: handle_new_user trigger with safe NULL handling
-- ============================================================
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Atomic Credit Function
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

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pinned_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_jobs ENABLE ROW LEVEL SECURITY;

-- POLICIES
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
END $$;

-- 6. ATOMIC WITHDRAWAL FUNCTION
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

-- ============================================================
-- SnipeJob: Withdrawal payout timing
-- Free tier withdrawals are queued for monthly batch payout;
-- Pro tier withdrawals are flagged for immediate processing.
-- Run this AFTER schema.sql.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='tier_at_request') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN tier_at_request TEXT DEFAULT 'free';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='scheduled_payout_date') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN scheduled_payout_date DATE;
    END IF;
END $$;