-- 1. Create auto_apply_settings table
CREATE TABLE public.auto_apply_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_titles TEXT[] DEFAULT '{}',
  target_locations TEXT[] DEFAULT '{}',
  daily_limit INTEGER DEFAULT 10,
  blacklist_companies TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.auto_apply_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own auto apply settings"
  ON public.auto_apply_settings FOR ALL
  USING ( auth.uid() = user_id )
  WITH CHECK ( auth.uid() = user_id );

-- 2. Create application_tracker table
CREATE TABLE public.application_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  job_url TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'applied'
);

ALTER TABLE public.application_tracker ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own application tracker"
  ON public.application_tracker FOR SELECT
  USING ( auth.uid() = user_id );
CREATE POLICY "Users can insert into application tracker"
  ON public.application_tracker FOR INSERT
  WITH CHECK ( auth.uid() = user_id );
