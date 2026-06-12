-- SnipeJob Supabase Database Schema

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USER PROFILES TABLE
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    registered_country VARCHAR(2) NOT NULL,
    verified_phone TEXT NOT NULL,
    identity_status TEXT CHECK (identity_status IN ('unverified', 'pending', 'verified', 'flagged')) DEFAULT 'unverified',
    id_image_url TEXT, -- Path to uploaded ID document
    current_tier TEXT CHECK (current_tier IN ('free', 'paid')) DEFAULT 'free',
    subscription_expiry TIMESTAMP WITH TIME ZONE, -- For Pro plan tracking
    wallet_balance DECIMAL(12,2) DEFAULT 0.00,
    preferred_payout_address TEXT, -- Crypto or PayPal address
    vpn_violation_count INT DEFAULT 0,
    tracks_selected TEXT[] DEFAULT '{}', -- Max 3 for free tier
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- JOB REPOSITORY TABLE
CREATE TABLE public.scraped_jobs (
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

-- USER ACTIVE MANAGEMENT DASHBOARD SYSTEM
CREATE TABLE public.user_pinned_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    job_id UUID REFERENCES public.scraped_jobs(id) ON DELETE CASCADE NOT NULL,
    system_status TEXT CHECK (system_status IN ('pinned', 'in_progress', 'completed')) DEFAULT 'pinned',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, job_id)
);

-- COMPREHENSIVE AFFILIATE SYSTEM TRACKING LOGS
CREATE TABLE public.affiliate_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    tracking_subid TEXT UNIQUE NOT NULL,
    incoming_network_provider TEXT NOT NULL,
    full_raw_payout DECIMAL(10,4) NOT NULL,
    user_credited_amount DECIMAL(10,4) NOT NULL,
    validation_ip TEXT NOT NULL,
    processing_timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- LIQUIDITY AND WITHDRAWAL LEDGERS
CREATE TABLE public.withdrawal_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    payment_channel TEXT NOT NULL,
    target_address TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'disbursed', 'denied')) DEFAULT 'pending',
    handled_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- CREATE PERFORMANCE TUNING INDEX MARKS
CREATE INDEX idx_jobs_sector ON public.scraped_jobs(sector);
CREATE INDEX idx_jobs_indexed_at ON public.scraped_jobs(indexed_at);
CREATE INDEX idx_profiles_status ON public.profiles(identity_status);

-- REVENUE BALANCE ATOMIC SAFEGUARD TRANSACTION ROUTINE
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

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pinned_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view their own pinned jobs" ON public.user_pinned_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own pinned jobs" ON public.user_pinned_jobs FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own withdrawal requests" ON public.withdrawal_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create withdrawal requests" ON public.withdrawal_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
