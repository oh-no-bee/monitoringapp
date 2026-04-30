CREATE TABLE IF NOT EXISTS public.branding (
  id text PRIMARY KEY DEFAULT 'singleton',
  logo_data_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branding_singleton CHECK (id = 'singleton')
);

ALTER TABLE public.branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branding read all" ON public.branding FOR SELECT USING (true);
CREATE POLICY "branding write all" ON public.branding FOR INSERT WITH CHECK (true);
CREATE POLICY "branding update all" ON public.branding FOR UPDATE USING (true) WITH CHECK (true);

INSERT INTO public.branding (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.branding REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.branding;