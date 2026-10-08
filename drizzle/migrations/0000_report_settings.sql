CREATE TABLE public.report_settings (id text PRIMARY KEY DEFAULT 'default', config jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_settings TO anon, authenticated;
GRANT ALL ON public.report_settings TO service_role;
ALTER TABLE public.report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access report settings" ON public.report_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);