-- SnipeJob Supabase Database Schema (Idempotent Version)

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USER PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    registered_country VARCHAR(2) NOT NULL,
    verified_phone TEXT NOT NULL,
    identity_status TEXT CHECK (identity_status IN ('unverified', 'pending', 'verified', 'flagged')) DEFAULT 'unverified',
    id_image_url TEXT,
    current_tier TEXT CHECK (current_tier IN ('free', 'paid')) DEFAULT 'free',
    subscription_expiry TIMESTAMP WITH TIME ZONE,
    wallet_balance DECIMAL(12,2) DEFAULT 0.00,
    preferred_payout_address TEXT,
    vpn_violation_count INT DEFAULT 0,
    tracks_selected TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. JOB REPOSITORY TABLE
CREATE TABLE IF NOT EXISTS public.scraped_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    sector TEXT CHECK (sector IN ('web', 'data', 'video', 'design', 'ai', 'writing', 'mobile', 'cyber', 'marketing', 'other')) NOT NULL,
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

-- Ensure profiles has all necessary columns if it already existed
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='wallet_balance') THEN
        ALTER TABLE public.profiles ADD COLUMN wallet_balance DECIMAL(12,2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='current_tier') THEN
        ALTER TABLE public.profiles ADD COLUMN current_tier TEXT DEFAULT 'free';
    END IF;
END $$;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_jobs_sector ON public.scraped_jobs(sector);
CREATE INDEX IF NOT EXISTS idx_jobs_indexed_at ON public.scraped_jobs(indexed_at);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(identity_status);

-- FUNCTIONS
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, registered_country, verified_phone, tracks_selected)
  VALUES (
    NEW.id, 
    NEW.email, 
    COALESCE(NEW.raw_user_meta_data->>'country', 'UN'), 
    '',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'sectors')), '{}'::text[])
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- TRIGGERS
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS (Safe to run multiple times)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pinned_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_jobs ENABLE ROW LEVEL SECURITY;

-- POLICIES (Use DO block to prevent "already exists" errors)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own profile') THEN
        CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update their own profile') THEN
        CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
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
