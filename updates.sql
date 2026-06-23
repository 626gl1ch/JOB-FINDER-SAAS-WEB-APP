-- Backs /api/interview/start — table never existed, route was failing silently
CREATE TABLE IF NOT EXISTS public.interview_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    job_id UUID REFERENCES public.scraped_jobs(id) ON DELETE SET NULL,
    sector TEXT,
    tier_at_time TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Backs /api/interview/answer
CREATE TABLE IF NOT EXISTS public.interview_answers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES public.interview_sessions(id) ON DELETE CASCADE NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    score INT,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Backs /api/trends — kept fresh automatically by the worker.js patch below, no manual cron needed
CREATE TABLE IF NOT EXISTS public.sector_trends (
    sector TEXT PRIMARY KEY,
    trending_skills TEXT[] DEFAULT '{}',
    recommended_certs TEXT[] DEFAULT '{}',
    summary TEXT DEFAULT '',
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_trends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
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
END $$;

-- FIX: GET /api/earnings always returned [] for every user — affiliate_logs
-- had RLS enabled with no SELECT policy at all.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own affiliate logs') THEN
        CREATE POLICY "Users can view their own affiliate logs" ON public.affiliate_logs FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

-- Required by your existing PAYMENT_SETUP_DIRECTIONS.txt Stripe integration
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- FIX: the OLD process_withdrawal() blocks free-tier withdrawals outright,
-- contradicting your own landing page and the JS-level fix already in
-- worker.js's /api/withdraw route. That old function is stale — don't call
-- it. This replacement keeps the same atomic, race-condition-safe check
-- but works for every tier, matching your actual business rules.
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
